import "dotenv/config";
import axios from "axios";

const ZERION_BASE = "https://api.zerion.io/v1";

function zerionHeaders() {
  const key = process.env.ZERION_API_KEY;
  if (!key) throw new Error("ZERION_API_KEY is not set");
  return {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
  };
}

// ─── Test wallet (Vitalik's public wallet) ──────────────────
const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function quickScan(address: string) {
  console.log(`\n=== WALLETSCOPE Quick Scan ===`);
  console.log(`Address: ${address}\n`);

  const resp = await axios.get(
    `${ZERION_BASE}/wallets/${address}/positions/?filter[position_types]=wallet&currency=usd&sort=-value&page[size]=10`,
    { headers: zerionHeaders() }
  );

  const positions = resp.data.data || [];
  let totalValueUsd = 0;
  const tokens: { symbol: string; value: number; pct: number }[] = [];

  for (const pos of positions) {
    const attr = pos.attributes;
    const value = attr.value ?? 0;
    totalValueUsd += value;
    tokens.push({
      symbol: attr.fungible_info?.symbol ?? "???",
      value: Math.round(value * 100) / 100,
      pct: 0,
    });
  }

  for (const t of tokens) {
    t.pct = totalValueUsd > 0 ? Math.round((t.value / totalValueUsd) * 10000) / 100 : 0;
  }

  console.log(`Total Value: $${totalValueUsd.toLocaleString()}`);
  console.log(`Tokens: ${positions.length}\n`);
  console.log(`Top Holdings:`);
  tokens.slice(0, 10).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.symbol} — $${t.value.toLocaleString()} (${t.pct}%)`);
  });

  return { totalValueUsd, tokenCount: positions.length, tokens };
}

async function behaviorReport(address: string) {
  console.log(`\n=== WALLETSCOPE Behavior Report ===`);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const resp = await axios.get(
    `${ZERION_BASE}/wallets/${address}/transactions/?filter[operated_at][gte]=${thirtyDaysAgo}&currency=usd&page[size]=100`,
    { headers: zerionHeaders() }
  );

  const txs = resp.data.data || [];
  const txCount = txs.length;
  const avgPerDay = Math.round((txCount / 30) * 100) / 100;

  const actionCounts: Record<string, number> = {};
  const interactions = new Set<string>();

  for (const tx of txs) {
    const attr = tx.attributes;
    const op = attr.operation_type ?? "unknown";
    actionCounts[op] = (actionCounts[op] || 0) + 1;
    for (const transfer of attr.transfers ?? []) {
      const addr = transfer.fungible_info?.implementations?.[0]?.address;
      if (addr) interactions.add(addr);
    }
  }

  let style = "Inactive";
  if (avgPerDay >= 5) style = "Active Trader";
  else if (avgPerDay >= 1) style = "Moderate";
  else if (txCount >= 1) style = "Holder";

  console.log(`  Transactions (30d): ${txCount}`);
  console.log(`  Avg/Day: ${avgPerDay}`);
  console.log(`  Unique Interactions: ${interactions.size}`);
  console.log(`  Trading Style: ${style}`);
  console.log(`\n  Top Actions:`);

  Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([action, count]) => console.log(`    - ${action} (${count})`));

  return { txCount, avgPerDay, interactions: interactions.size, style };
}

function trustScore(
  portfolio: { totalValueUsd: number; tokenCount: number; tokens: { pct: number }[] },
  behavior: { txCount: number; avgPerDay: number; interactions: number; style: string }
) {
  const topPct = portfolio.tokens[0]?.pct ?? 100;

  let s1 = portfolio.totalValueUsd >= 100000 ? 20 : portfolio.totalValueUsd >= 10000 ? 15 : portfolio.totalValueUsd >= 1000 ? 10 : 5;
  let s2 = portfolio.tokenCount >= 10 && topPct < 50 ? 20 : portfolio.tokenCount >= 5 && topPct < 70 ? 15 : portfolio.tokenCount >= 3 ? 10 : 5;
  let s3 = behavior.avgPerDay >= 3 ? 20 : behavior.avgPerDay >= 1 ? 15 : behavior.txCount >= 5 ? 10 : behavior.txCount >= 1 ? 5 : 0;
  let s4 = behavior.interactions >= 20 && behavior.style !== "Active Trader" ? 20 : behavior.interactions >= 10 ? 15 : behavior.interactions >= 5 ? 10 : 5;
  let s5 = topPct < 30 ? 20 : topPct < 50 ? 15 : topPct < 70 ? 10 : 5;

  const score = s1 + s2 + s3 + s4 + s5;
  const grade = score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : score >= 25 ? "LOW" : "VERY LOW";

  console.log(`\n=== TRUST SCORE ===`);
  console.log(`  Score: ${score}/100 — ${grade}`);
  console.log(`  Portfolio Size:   ${s1}/20`);
  console.log(`  Diversification:  ${s2}/20`);
  console.log(`  Activity:         ${s3}/20`);
  console.log(`  Holding Duration: ${s4}/20`);
  console.log(`  Risk Exposure:    ${s5}/20`);
  console.log(
    score >= 50
      ? `\n  ✓ Reasonable on-chain credibility. Proceed with standard caution.`
      : `\n  ⚠ Low trust indicators. Exercise extra caution before copy-trading.`
  );
}

(async () => {
  const wallet = process.argv[2] || TEST_WALLET;
  console.log(`\nWALLETSCOPE — Testing wallet: ${wallet}`);
  console.log("─".repeat(50));

  try {
    const portfolio = await quickScan(wallet);
    const behavior = await behaviorReport(wallet);
    trustScore(portfolio, behavior);
  } catch (err: any) {
    console.error(`\nError: ${err.message}`);
    if (err.response) console.error(`Status: ${err.response.status}`, err.response.data);
  }
})();

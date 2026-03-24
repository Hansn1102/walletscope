import "dotenv/config";
import axios from "axios";
import {
  GameAgent,
  GameWorker,
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

// ─── Zerion API ─────────────────────────────────────────────

const ZERION_BASE = "https://api.zerion.io/v1";

function zerionHeaders() {
  const key = process.env.ZERION_API_KEY;
  if (!key) throw new Error("ZERION_API_KEY is not set");
  return {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
  };
}

// ─── Types ──────────────────────────────────────────────────

interface TokenPosition {
  symbol: string;
  name: string;
  quantity: number;
  valueUsd: number;
  pctOfPortfolio: number;
}

interface PortfolioSummary {
  address: string;
  totalValueUsd: number;
  tokenCount: number;
  top10: TokenPosition[];
}

interface TransactionPattern {
  address: string;
  txCount30d: number;
  avgTxPerDay: number;
  uniqueInteractions: number;
  tradingStyle: "Active Trader" | "Moderate" | "Holder" | "Inactive";
  topActions: string[];
}

interface TrustScore {
  address: string;
  score: number;
  grade: "HIGH" | "MEDIUM" | "LOW" | "VERY LOW";
  factors: {
    portfolioSize: number;
    diversification: number;
    activity: number;
    holdingDuration: number;
    riskExposure: number;
  };
  summary: string;
}

// ─── Core Functions ─────────────────────────────────────────

async function getWalletPortfolio(
  address: string
): Promise<PortfolioSummary> {
  const resp = await axios.get(
    `${ZERION_BASE}/wallets/${address}/positions/?filter[position_types]=wallet&currency=usd&sort=-value`,
    { headers: zerionHeaders() }
  );

  const positions = resp.data.data || [];
  let totalValueUsd = 0;
  const tokens: TokenPosition[] = [];

  for (const pos of positions) {
    const attr = pos.attributes;
    const value = attr.value ?? 0;
    totalValueUsd += value;
    tokens.push({
      symbol: attr.fungible_info?.symbol ?? "???",
      name: attr.fungible_info?.name ?? "Unknown",
      quantity: attr.quantity?.float ?? 0,
      valueUsd: value,
      pctOfPortfolio: 0,
    });
  }

  // Calculate percentages & take top 10
  for (const t of tokens) {
    t.pctOfPortfolio =
      totalValueUsd > 0
        ? Math.round((t.valueUsd / totalValueUsd) * 10000) / 100
        : 0;
  }

  const top10 = tokens.slice(0, 10);

  return {
    address,
    totalValueUsd: Math.round(totalValueUsd * 100) / 100,
    tokenCount: tokens.length,
    top10,
  };
}

async function getTransactionPattern(
  address: string
): Promise<TransactionPattern> {
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const resp = await axios.get(
    `${ZERION_BASE}/wallets/${address}/transactions/?filter[operated_at][gte]=${thirtyDaysAgo}&currency=usd&page[size]=100`,
    { headers: zerionHeaders() }
  );

  const txs = resp.data.data || [];
  const txCount30d = txs.length;
  const avgTxPerDay = Math.round((txCount30d / 30) * 100) / 100;

  const interactionsSet = new Set<string>();
  const actionCounts: Record<string, number> = {};

  for (const tx of txs) {
    const attr = tx.attributes;
    const opType = attr.operation_type ?? "unknown";
    actionCounts[opType] = (actionCounts[opType] || 0) + 1;

    for (const transfer of attr.transfers ?? []) {
      const addr =
        transfer.fungible_info?.implementations?.[0]?.address;
      if (addr) interactionsSet.add(addr);
    }
  }

  const topActions = Object.entries(actionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([action, count]) => `${action} (${count})`);

  let tradingStyle: TransactionPattern["tradingStyle"];
  if (avgTxPerDay >= 5) tradingStyle = "Active Trader";
  else if (avgTxPerDay >= 1) tradingStyle = "Moderate";
  else if (txCount30d >= 1) tradingStyle = "Holder";
  else tradingStyle = "Inactive";

  return {
    address,
    txCount30d,
    avgTxPerDay,
    uniqueInteractions: interactionsSet.size,
    tradingStyle,
    topActions,
  };
}

function calculateTrustScore(
  portfolio: PortfolioSummary,
  pattern: TransactionPattern
): TrustScore {
  // Factor 1: Portfolio Size (0-20)
  let portfolioSize = 0;
  if (portfolio.totalValueUsd >= 100000) portfolioSize = 20;
  else if (portfolio.totalValueUsd >= 10000) portfolioSize = 15;
  else if (portfolio.totalValueUsd >= 1000) portfolioSize = 10;
  else if (portfolio.totalValueUsd >= 100) portfolioSize = 5;

  // Factor 2: Diversification (0-20)
  let diversification = 0;
  const topTokenPct = portfolio.top10[0]?.pctOfPortfolio ?? 100;
  if (portfolio.tokenCount >= 10 && topTokenPct < 50) diversification = 20;
  else if (portfolio.tokenCount >= 5 && topTokenPct < 70) diversification = 15;
  else if (portfolio.tokenCount >= 3) diversification = 10;
  else diversification = 5;

  // Factor 3: Activity (0-20)
  let activity = 0;
  if (pattern.avgTxPerDay >= 3) activity = 20;
  else if (pattern.avgTxPerDay >= 1) activity = 15;
  else if (pattern.txCount30d >= 5) activity = 10;
  else if (pattern.txCount30d >= 1) activity = 5;

  // Factor 4: Holding Duration proxy (0-20)
  // More unique interactions + moderate activity = longer holding
  let holdingDuration = 0;
  if (pattern.uniqueInteractions >= 20 && pattern.tradingStyle !== "Active Trader")
    holdingDuration = 20;
  else if (pattern.uniqueInteractions >= 10) holdingDuration = 15;
  else if (pattern.uniqueInteractions >= 5) holdingDuration = 10;
  else holdingDuration = 5;

  // Factor 5: Risk Exposure (0-20)
  // Lower concentration in single token = lower risk
  let riskExposure = 0;
  if (topTokenPct < 30) riskExposure = 20;
  else if (topTokenPct < 50) riskExposure = 15;
  else if (topTokenPct < 70) riskExposure = 10;
  else riskExposure = 5;

  const score =
    portfolioSize + diversification + activity + holdingDuration + riskExposure;

  let grade: TrustScore["grade"];
  if (score >= 75) grade = "HIGH";
  else if (score >= 50) grade = "MEDIUM";
  else if (score >= 25) grade = "LOW";
  else grade = "VERY LOW";

  const summary = [
    `Trust Score: ${score}/100 (${grade})`,
    `Portfolio: $${portfolio.totalValueUsd.toLocaleString()} across ${portfolio.tokenCount} tokens`,
    `Activity: ${pattern.txCount30d} txs in 30d (${pattern.tradingStyle})`,
    `Top token concentration: ${topTokenPct}%`,
  ].join("\n");

  return {
    address: portfolio.address,
    score,
    grade,
    factors: {
      portfolioSize,
      diversification,
      activity,
      holdingDuration,
      riskExposure,
    },
    summary,
  };
}

// ─── GAME Functions ─────────────────────────────────────────

const quickScanFn = new GameFunction({
  name: "quick_scan",
  description:
    "Quick Scan ($0.5 USDC): Returns portfolio summary — total value, token count, top 10 holdings.",
  args: [
    {
      name: "wallet_address",
      description: "The wallet address to scan (0x...)",
    },
  ] as const,
  executable: async (args) => {
    try {
      const address = args.wallet_address;
      if (!address) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "wallet_address is required"
        );
      }

      const portfolio = await getWalletPortfolio(address);

      const topTokensStr = portfolio.top10
        .map(
          (t, i) =>
            `${i + 1}. ${t.symbol} — $${t.valueUsd.toLocaleString()} (${t.pctOfPortfolio}%)`
        )
        .join("\n");

      const result = [
        `=== WALLETSCOPE Quick Scan ===`,
        `Address: ${portfolio.address}`,
        `Total Value: $${portfolio.totalValueUsd.toLocaleString()}`,
        `Tokens Held: ${portfolio.tokenCount}`,
        ``,
        `Top Holdings:`,
        topTokensStr,
      ].join("\n");

      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        result
      );
    } catch (err: any) {
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Failed,
        `Scan failed: ${err.message}`
      );
    }
  },
});

const behaviorReportFn = new GameFunction({
  name: "behavior_report",
  description:
    "Behavior Report ($1.5 USDC): Analyzes 30-day transaction patterns — tx count, trading style, top actions.",
  args: [
    {
      name: "wallet_address",
      description: "The wallet address to analyze (0x...)",
    },
  ] as const,
  executable: async (args) => {
    try {
      const address = args.wallet_address;
      if (!address) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "wallet_address is required"
        );
      }

      const portfolio = await getWalletPortfolio(address);
      const pattern = await getTransactionPattern(address);

      const result = [
        `=== WALLETSCOPE Behavior Report ===`,
        `Address: ${address}`,
        ``,
        `Portfolio: $${portfolio.totalValueUsd.toLocaleString()} (${portfolio.tokenCount} tokens)`,
        ``,
        `30-Day Activity:`,
        `  Transactions: ${pattern.txCount30d}`,
        `  Avg/Day: ${pattern.avgTxPerDay}`,
        `  Unique Interactions: ${pattern.uniqueInteractions}`,
        `  Trading Style: ${pattern.tradingStyle}`,
        ``,
        `Top Actions:`,
        pattern.topActions.map((a) => `  - ${a}`).join("\n"),
      ].join("\n");

      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        result
      );
    } catch (err: any) {
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Failed,
        `Report failed: ${err.message}`
      );
    }
  },
});

const deepProfileFn = new GameFunction({
  name: "deep_profile",
  description:
    "Deep Profile ($3 USDC): Full Trust Score (0-100) with grade, factor breakdown, portfolio, and behavior analysis.",
  args: [
    {
      name: "wallet_address",
      description: "The wallet address to profile (0x...)",
    },
  ] as const,
  executable: async (args) => {
    try {
      const address = args.wallet_address;
      if (!address) {
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Failed,
          "wallet_address is required"
        );
      }

      const portfolio = await getWalletPortfolio(address);
      const pattern = await getTransactionPattern(address);
      const trust = calculateTrustScore(portfolio, pattern);

      const topTokensStr = portfolio.top10
        .slice(0, 5)
        .map(
          (t, i) =>
            `${i + 1}. ${t.symbol} — $${t.valueUsd.toLocaleString()} (${t.pctOfPortfolio}%)`
        )
        .join("\n");

      const result = [
        `=== WALLETSCOPE Deep Profile ===`,
        `Address: ${address}`,
        ``,
        `TRUST SCORE: ${trust.score}/100 — ${trust.grade}`,
        ``,
        `Score Breakdown:`,
        `  Portfolio Size:   ${trust.factors.portfolioSize}/20`,
        `  Diversification:  ${trust.factors.diversification}/20`,
        `  Activity:         ${trust.factors.activity}/20`,
        `  Holding Duration: ${trust.factors.holdingDuration}/20`,
        `  Risk Exposure:    ${trust.factors.riskExposure}/20`,
        ``,
        `Portfolio: $${portfolio.totalValueUsd.toLocaleString()} (${portfolio.tokenCount} tokens)`,
        `Top Holdings:`,
        topTokensStr,
        ``,
        `30-Day Behavior:`,
        `  Transactions: ${pattern.txCount30d} (${pattern.avgTxPerDay}/day)`,
        `  Style: ${pattern.tradingStyle}`,
        `  Unique Interactions: ${pattern.uniqueInteractions}`,
        ``,
        pattern.topActions.length > 0
          ? `Top Actions:\n${pattern.topActions.map((a) => `  - ${a}`).join("\n")}`
          : "",
        ``,
        `---`,
        trust.score >= 50
          ? `This wallet shows reasonable on-chain credibility. Proceed with standard caution.`
          : `Warning: Low trust indicators detected. Exercise extra caution before copy-trading this wallet.`,
      ].join("\n");

      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        result
      );
    } catch (err: any) {
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Failed,
        `Deep profile failed: ${err.message}`
      );
    }
  },
});

// ─── Worker & Agent ─────────────────────────────────────────

const walletWorker = new GameWorker({
  id: "wallet_analyst",
  name: "Wallet Analyst",
  description:
    "Analyzes on-chain wallets for copy-trading due diligence. Offers Quick Scan, Behavior Report, and Deep Profile services.",
  functions: [quickScanFn, behaviorReportFn, deepProfileFn],
});

const agent = new GameAgent(process.env.GAME_API_KEY!, {
  name: "WALLETSCOPE",
  goal: "Help copy-traders verify wallet credibility before following. Provide accurate, data-driven wallet analysis with zero hallucination — only real on-chain data from Zerion API.",
  description:
    "On-chain detective for copy-traders. Give me a wallet address and I'll tell you if it's worth following. I analyze portfolios, transaction patterns, and calculate Trust Scores (0-100) based purely on real data. No predictions, no speculation — just facts.",
  workers: [walletWorker],
});

// ─── Start ──────────────────────────────────────────────────

(async () => {
  console.log("Starting WALLETSCOPE agent...");
  try {
    await agent.init();
    console.log("WALLETSCOPE agent is live.");
  } catch (err) {
    console.error("Failed to start agent:", err);
    process.exit(1);
  }
})();

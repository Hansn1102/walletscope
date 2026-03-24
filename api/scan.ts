import type { VercelRequest, VercelResponse } from "@vercel/node";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Extract address from path: /api/scan/0x...
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ["api", "scan", "0x..."]
  const address = pathParts[2];
  const tier = (req.query.tier as string) || "deep";

  if (!address || !address.startsWith("0x")) {
    return res.status(400).json({ error: "Valid wallet address required (0x...)" });
  }

  try {
    // Portfolio
    const posResp = await axios.get(
      `${ZERION_BASE}/wallets/${address}/positions/?filter[position_types]=wallet&currency=usd&sort=-value&page[size]=50`,
      { headers: zerionHeaders() }
    );

    const positions = posResp.data.data || [];
    let totalValueUsd = 0;
    const tokens: any[] = [];

    for (const pos of positions) {
      const attr = pos.attributes;
      const value = attr.value ?? 0;
      totalValueUsd += value;
      tokens.push({
        symbol: attr.fungible_info?.symbol ?? "???",
        name: attr.fungible_info?.name ?? "Unknown",
        quantity: attr.quantity?.float ?? 0,
        value: Math.round(value * 100) / 100,
        pct: 0,
        icon: attr.fungible_info?.icon?.url ?? null,
      });
    }

    const validTokens = tokens.filter((t) => t.value > 0);
    for (const t of validTokens) {
      t.pct = totalValueUsd > 0 ? Math.round((t.value / totalValueUsd) * 10000) / 100 : 0;
    }
    const top10 = validTokens.slice(0, 10);

    const portfolio = {
      address,
      totalValueUsd: Math.round(totalValueUsd * 100) / 100,
      tokenCount: validTokens.length,
      totalTokenCount: tokens.length,
      top10,
    };

    if (tier === "quick") return res.json({ portfolio });

    // Transactions (30d)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const txResp = await axios.get(
      `${ZERION_BASE}/wallets/${address}/transactions/?filter[operated_at][gte]=${thirtyDaysAgo}&currency=usd&page[size]=100`,
      { headers: zerionHeaders() }
    );

    const txs = txResp.data.data || [];
    const txCount = txs.length;
    const avgPerDay = Math.round((txCount / 30) * 100) / 100;

    const actionCounts: Record<string, number> = {};
    const interactions = new Set<string>();
    const dailyTxs: Record<string, number> = {};

    for (const tx of txs) {
      const attr = tx.attributes;
      const op = attr.operation_type ?? "unknown";
      actionCounts[op] = (actionCounts[op] || 0) + 1;
      const day = attr.mined_at?.slice(0, 10) ?? "unknown";
      dailyTxs[day] = (dailyTxs[day] || 0) + 1;
      for (const transfer of attr.transfers ?? []) {
        const addr = transfer.fungible_info?.implementations?.[0]?.address;
        if (addr) interactions.add(addr);
      }
    }

    let tradingStyle = "Inactive";
    if (avgPerDay >= 5) tradingStyle = "Active Trader";
    else if (avgPerDay >= 1) tradingStyle = "Moderate";
    else if (txCount >= 1) tradingStyle = "Holder";

    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));

    const behavior = { txCount, avgPerDay, uniqueInteractions: interactions.size, tradingStyle, topActions, dailyTxs };

    if (tier === "behavior") return res.json({ portfolio, behavior });

    // Trust Score
    const topPct = top10[0]?.pct ?? 100;
    const s1 = totalValueUsd >= 100000 ? 20 : totalValueUsd >= 10000 ? 15 : totalValueUsd >= 1000 ? 10 : totalValueUsd >= 100 ? 5 : 0;
    const s2 = validTokens.length >= 10 && topPct < 50 ? 20 : validTokens.length >= 5 && topPct < 70 ? 15 : validTokens.length >= 3 ? 10 : 5;
    const s3 = avgPerDay >= 3 ? 20 : avgPerDay >= 1 ? 15 : txCount >= 5 ? 10 : txCount >= 1 ? 5 : 0;
    const s4 = interactions.size >= 20 && tradingStyle !== "Active Trader" ? 20 : interactions.size >= 10 ? 15 : interactions.size >= 5 ? 10 : 5;
    const s5 = topPct < 30 ? 20 : topPct < 50 ? 15 : topPct < 70 ? 10 : 5;

    const score = s1 + s2 + s3 + s4 + s5;
    const grade = score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : score >= 25 ? "LOW" : "VERY LOW";

    const trustScore = {
      score,
      grade,
      factors: { portfolioSize: s1, diversification: s2, activity: s3, holdingDuration: s4, riskExposure: s5 },
    };

    return res.json({ portfolio, behavior, trustScore });
  } catch (err: any) {
    const status = err.response?.status || 500;
    return res.status(status).json({ error: err.message });
  }
}

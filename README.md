# WALLETSCOPE

**On-chain wallet analysis agent — verify a wallet's trustworthiness before you copy-trade it.**

[![Live](https://img.shields.io/badge/demo-live-black)](https://walletscope-nine.vercel.app)
&nbsp;`GAME SDK` · `Zerion API` · `TypeScript` · `Vercel`

🔗 **Live demo:** https://walletscope-nine.vercel.app

---

## The problem

Copy-trading in crypto starts with one question: *"Can I trust this wallet enough to follow it?"* The tools that answer it (Nansen, Arkham) are expensive monthly subscriptions — overkill for someone who just wants to check one wallet, once.

## The approach

An autonomous agent on **Virtuals Protocol ACP**, priced **per query** instead of per month.

- Built on the **GAME SDK (TypeScript)** — the agent orchestrates tools and a reasoning loop, pulling live on-chain data from the **Zerion API**.
- Wallet trustworthiness is normalized into a single **Trust Score (0–100)**.
- **Zero-hallucination principle:** the agent answers *only* from verified on-chain data — never from the model's guesses. Grounding the output in a real data source is what makes a "trust" tool actually trustworthy.
- Three service tiers so users pay for the depth they need.

## Services

| Tier | Price | What you get |
|------|-------|-------------|
| Quick Scan | $0.5 USDC | Portfolio summary, top 10 holdings |
| Behavior Report | $1.5 USDC | 30-day transaction pattern analysis |
| Deep Profile | $3 USDC | Full Trust Score (0–100) + comprehensive analysis |

## Verification

Tested against Vitalik Buterin's wallet → **Trust Score 95/100 (HIGH)**, correctly computed from real portfolio and activity data. Dashboard renders a Trust Score ring, portfolio donut, 30-day activity bars, and holdings/transaction-type breakdowns (Chart.js). Deployed from local to Vercel serverless (`api/scan.ts`), with API keys kept out of the bundle via environment variables.

## What I learned

- **An agent is a model + tools + a loop.** Implementing that structure end-to-end made the abstraction concrete.
- To keep an agent honest, you don't tune the model — you **force it to answer from a verified data source**. That single constraint is what a "trust score" product lives or dies on.
- Working real API rate limits (free tier: 10 req / 5 min) into an actual user-facing service flow.

---

## Architecture

```
agent.ts          GAME SDK agent (Quick Scan · Behavior Report · Deep Profile)
server.ts         Express dashboard server (local)
api/scan.ts       Vercel serverless function
public/index.html Dashboard UI (Tailwind + Chart.js)
test.ts           CLI test harness
```

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

- **GAME_API_KEY** — [console.game.virtuals.io](https://console.game.virtuals.io)
- **ZERION_API_KEY** — [developers.zerion.io](https://developers.zerion.io)

## Run

```bash
npm start
```

## Deploy (Vercel)

Push to GitHub, import the repo in Vercel, set `ZERION_API_KEY` in Environment Variables, and deploy. The dashboard is served statically and calls the `api/scan.ts` serverless function.

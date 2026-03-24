# WALLETSCOPE

On-chain wallet analysis agent powered by Virtuals Protocol ACP.
Copy-trading due diligence tool — verify wallets before you follow.

## Services

| Tier | Price | What you get |
|------|-------|-------------|
| Quick Scan | $0.5 USDC | Portfolio summary, top 10 holdings |
| Behavior Report | $1.5 USDC | 30-day transaction pattern analysis |
| Deep Profile | $3 USDC | Full Trust Score (0-100) + comprehensive analysis |

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` with your API keys:

- **GAME_API_KEY**: Get from [console.game.virtuals.io](https://console.game.virtuals.io)
- **ZERION_API_KEY**: Get from [developers.zerion.io](https://developers.zerion.io)

## Run

```bash
npm start
```

## Deploy (Railway)

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in the Variables tab
4. Deploy

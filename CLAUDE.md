# TradeLadder

## What This Is

TradeLadder is a web-based companion dashboard for ES futures traders who follow Adam Mancini's daily trade plans. It replaces the pen-and-paper workflow of manually extracting levels, tracking trades, and calculating P&L from Mancini's Substack newsletter.

The app is built for a specific user (my dad) who is not tech savvy, trades ES/MES/MNQ futures on Optimus Flow, charts on ThinkorSwim, and does everything else — level extraction, scenario planning, trade logging, P&L math — by hand on paper with a red pen.

The long-term vision is to productize this as a SaaS for Mancini's subscriber base (est. 3,000-10,000+ paid subscribers) and potentially partner with Mancini directly.

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS 4 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password) |
| Deployment | Render |
| Domain | tradeladder.io |
| Email Pipeline | Zapier (Gmail → webhook) |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard (3 tabs, date navigator, header)
│   ├── layout.tsx                  # Root layout with fonts
│   ├── globals.css                 # Dark trading theme CSS variables
│   ├── login/page.tsx              # Login page
│   ├── signup/page.tsx             # Signup page
│   ├── auth/callback/route.ts      # Email confirmation handler
│   └── api/
│       ├── ingest/route.ts         # POST - Zapier webhook (admin key, needs user_id)
│       ├── latest-plan/route.ts    # GET - fetch plan by session_date
│       ├── sessions/route.ts       # GET - list all session dates
│       ├── trades/route.ts         # GET/POST - trade log entries
│       ├── trades/[id]/route.ts    # PATCH/DELETE - individual trades
│       └── health/route.ts         # GET - health check
├── components/
│   ├── LevelLadder.tsx             # Vertical price ladder with S/R levels
│   ├── GamePlan.tsx                # Bull/bear paths + trigger cards
│   ├── TradeLog.tsx                # Trade entry/exit + P&L calculator
│   └── PasteModal.tsx              # Paste email text modal
├── lib/
│   ├── supabase.ts                 # Three Supabase clients (browser, server, admin)
│   ├── parser.ts                   # Mancini email parser + P&L calculator
│   └── types.ts                    # TypeScript interfaces
└── middleware.ts                   # Auth protection + session refresh
```

## Database Schema

Two tables, both with Row Level Security enabled:

**plans** — Stores each daily Mancini email
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `session_date` (date) — the trading day the plan applies to
- `email_date` (text) — when the email was received
- `subject` (text)
- `body` (text) — raw email content
- `created_at` (timestamptz)

**trades** — Trade log entries
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `session_date` (date) — links to the plan's session
- `symbol` (text) — ES, MES, MNQ, NQ
- `direction` (text) — long or short
- `contracts` (integer)
- `entry_price` (numeric)
- `exit_75_price` (numeric, nullable)
- `exit_runner_price` (numeric, nullable)
- `setup_type` (text) — Failed Breakdown, Flag, Trendline, Other
- `point_value` (numeric) — 50 for ES, 5 for MES, 2 for MNQ, 20 for NQ
- `notes` (text, nullable)
- `pnl` (numeric, nullable)
- `created_at` (timestamptz)

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_KEY=sb_secret_xxx
```

## Key Design Principles

1. Paper-simple — if the user would struggle to explain a feature, cut it
2. Big text, big buttons — numbers read quickly during live trading
3. Dark theme — matches Optimus Flow and TOS
4. Numbers first — monospaced, large typography for prices and P&L
5. Color = meaning — green=bullish/profit, red=bearish/loss, gold=major level, blue=current price
6. Graceful errors — no error modals, subtle inline messages

## Code Conventions

- Functional React components with hooks
- Comments explain WHY, not WHAT
- Flat structure, no unnecessary abstraction
- Plain naming: TradeLog, LevelLadder, GamePlan
- All API routes use try/catch with console.error logging
- Supabase clients: browser (client components), server (API routes with auth), admin (webhook only)

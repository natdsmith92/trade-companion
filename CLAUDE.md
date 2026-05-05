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
| Auth | Supabase Auth (email/password + Google OAuth) |
| LLM | OpenAI gpt-5.5 (TLDR generation today; level parser planned in Phase 5) |
| Deployment | Render |
| Domain | tradeladder.io |
| Email Pipeline | Resend inbound parsing (per-user forwarding addresses on `inbound.tradeladder.io`) — replaces earlier Zapier plan |
| Live Price | yahoo-finance2 (free, with staleness fallback) — Databento upgrade planned post-SaaS-launch |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard (3 tabs: plan, trades, tldr; date navigator, header)
│   ├── layout.tsx                  # Root layout with fonts
│   ├── globals.css                 # Dark trading theme CSS variables
│   ├── login/page.tsx              # Login page (email/password + Google OAuth)
│   ├── signup/page.tsx             # Signup page (email/password + Google OAuth)
│   ├── auth/callback/route.ts      # Email confirmation + OAuth callback handler
│   └── api/
│       ├── ingest/route.ts         # POST - manual paste / Resend webhook ingest (auth via per-user address)
│       ├── latest-plan/route.ts    # GET - fetch plan by session_date
│       ├── sessions/route.ts       # GET - list all session dates
│       ├── trades/route.ts         # GET/POST - trade log entries
│       ├── trades/[id]/route.ts    # PATCH/DELETE - individual trades
│       ├── tldr/route.ts           # GET - OpenAI gpt-5.5 generates session TL;DR from plan body
│       ├── es-price/route.ts       # GET - live ES futures quote via yahoo-finance2 (cached)
│       └── health/route.ts         # GET - health check
├── components/
│   ├── LevelLadder.tsx             # Vertical price ladder with S/R levels
│   ├── GamePlan.tsx                # Bull/bear paths + trigger cards
│   ├── TradeLog.tsx                # Trade entry/exit + P&L calculator
│   ├── TldrTab.tsx                 # AI-generated session summary (uses /api/tldr)
│   └── PasteModal.tsx              # Paste email text modal
├── lib/
│   ├── supabase-browser.ts         # Browser-side Supabase client (client components)
│   ├── supabase-server.ts          # Server-side Supabase clients (createServerSupabase + createAdminSupabase)
│   ├── parser.ts                   # Mancini email parser (regex-based today; Phase 5 replaces with OpenAI)
│   ├── generate-tldr.ts            # OpenAI gpt-5.5 system prompt + TldrData schema (~95-line prompt at lines 5-99)
│   ├── useESPrice.ts               # React hook polling /api/es-price for live quote
│   └── types.ts                    # TypeScript interfaces
└── middleware.ts                   # Auth protection + session refresh + public-path allowlist
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
- `tldr` (jsonb, nullable) — OpenAI gpt-5.5 generated TLDR (TldrData shape; written by /api/tldr, read by TldrTab)
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
OPENAI_API_KEY=sk-xxx                       # required by /api/tldr (and /api/parse-plan in Phase 5)

# Phase 4 (inbound email pipeline) — to add when Phase 4 lands:
# RESEND_API_KEY=re_xxx                      # for outbound transactional + inbound webhook auth
# RESEND_WEBHOOK_SECRET=whsec_xxx            # signature validation on inbound webhook

# F9 (admin gate) — to add when /admin/pitch lands:
# ADMIN_USER_IDS=uuid1,uuid2                 # comma-separated admin user UUIDs
# ADMIN_PITCH_TOKEN_SECRET=...               # HMAC secret for tokenized share URLs (F12)
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
- Supabase clients live in two files:
  - `src/lib/supabase-browser.ts` — browser client for client components
  - `src/lib/supabase-server.ts` — exports `createServerSupabase` (per-request, RLS-aware) and `createAdminSupabase` (service-key client, webhook-only)

## Documentation Map

This file is the entry point. Deeper detail lives in:

| Doc | When to read it |
|-----|-----------------|
| [README.md](README.md) | Public-facing project pitch + quick start |
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | First-time setup, clone → running dev server |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, hook layer, error boundary topology, request lifecycle |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Day-2 contributor conventions: adding routes, hooks, components, migrations |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every env var, script, migration, third-party config knob |
| [docs/TESTING.md](docs/TESTING.md) | Current state (no tests) and the planned F3 stack |
| [docs/API.md](docs/API.md) | All HTTP API routes with request/response shapes and curl examples |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product roadmap, phase plan |
| [docs/BUSINESS.md](docs/BUSINESS.md) | Business strategy, market thesis, partnership pathway |
| [CHANGELOG.md](CHANGELOG.md) | Versioned release notes |

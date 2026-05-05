<!-- generated-by: gsd-doc-writer -->
# TradeLadder

A web-based companion dashboard for ES futures traders who follow Adam Mancini's daily trade plans — paste the email, see the levels, log trades with auto P&L.

## What It Does

- **Paste a Mancini email, get a tradeable plan** — drop the day's Substack newsletter into the paste modal and TradeLadder extracts support/resistance levels, bull/bear paths, and trigger setups.
- **Vertical price ladder** — supports, resistances, and major levels rendered as a big-text vertical ladder that mirrors the way traders read the page on paper.
- **Game plan, side-by-side** — bull and bear scenarios with their trigger cards next to each other, so you know what you're watching for before the open.
- **Trade log with auto P&L** — enter symbol, direction, contracts, entry, and exits; point values for ES (50), MES (5), MNQ (2), and NQ (20) are baked in and P&L is calculated for you.
- **Date-aware sessions** — every plan and every trade is keyed to a `session_date`, so you can scroll back through past trading days without losing history.

## Tech Stack

| Layer            | Tool                                          |
|------------------|-----------------------------------------------|
| Framework        | Next.js 15 (App Router, TypeScript), React 19 |
| Styling          | Tailwind CSS 4                                |
| Database / Auth  | Supabase (PostgreSQL + Supabase Auth)         |
| LLM              | OpenAI (`openai` SDK)                         |
| Live prices      | `yahoo-finance2` with persistent cache fallback |
| Deployment       | Render                                        |
| Domain           | tradeladder.io                                |

## Quick Start

```bash
# 1. Clone
git clone <repo-url> tradeladder
cd tradeladder

# 2. Install deps
npm install

# 3. Configure environment
cp .env.example .env.local
# then fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_KEY, and OPENAI_API_KEY

# 4. Run the dev server
npm run dev
```

Then open http://localhost:3000, sign up via the login page, and paste a Mancini email to see it parsed.

Available scripts (from `package.json`):

| Command         | What it does                              |
|-----------------|-------------------------------------------|
| `npm run dev`   | Start the Next.js dev server              |
| `npm run build` | Build the production bundle               |
| `npm run start` | Run the production server                 |

Database setup uses the SQL files at the project root: `schema.sql`, plus the `migrate-*.sql` migrations. Apply them in your Supabase project's SQL editor.

## Documentation Map

For deeper detail, see the docs:

| Doc                                       | What's inside                                                  |
|-------------------------------------------|----------------------------------------------------------------|
| [CLAUDE.md](CLAUDE.md)                    | Project entry point — tech stack, structure, conventions       |
| [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) | Step-by-step setup from clone to first plan paste     |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, key abstractions             |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, build commands, code style                        |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars, scripts, migrations, third-party config         |
| [docs/TESTING.md](docs/TESTING.md)        | Current test state + planned F3 stack (Vitest + LLM evals)     |
| [docs/API.md](docs/API.md)                | API routes (`/api/ingest`, `/api/trades`, etc.) reference      |
| [docs/PRODUCT.md](docs/PRODUCT.md)        | Product roadmap and phase plan                                 |
| [docs/BUSINESS.md](docs/BUSINESS.md)      | Business strategy and SaaS launch direction                    |
| [CHANGELOG.md](CHANGELOG.md)              | Versioned release notes                                        |

## Status & Disclaimer

TradeLadder is currently a single-user app, built for one trader (the maintainer's father) to replace a pen-and-paper workflow during live ES futures trading. It is not yet a publicly available product.

A multi-tenant SaaS launch aimed at Adam Mancini's subscriber base is planned. See [docs/BUSINESS.md](docs/BUSINESS.md) for the strategic direction and [docs/PRODUCT.md](docs/PRODUCT.md) for the phased roadmap.

Nothing here is financial advice. TradeLadder is a workflow tool — it does not place trades and makes no guarantees about parsed levels or P&L calculations. Always verify against your broker.

## License

Private and unlicensed. All rights reserved by the maintainer. This repository is not open source; do not redistribute or use without permission.

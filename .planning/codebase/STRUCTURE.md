# Codebase Structure

**Analysis Date:** 2026-05-04

## Directory Layout

```
trade-companion/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Main dashboard (single-page, client component, ~410 lines)
│   │   ├── layout.tsx              # Root layout: metadata + Google fonts (Inter, JetBrains Mono)
│   │   ├── globals.css             # Dark trading theme + all hand-rolled CSS classes (~1,206 lines)
│   │   ├── favicon.ico
│   │   ├── icon.png
│   │   ├── login/page.tsx          # Email/password + Google OAuth sign-in (~408 lines, heavy inline styles)
│   │   ├── signup/page.tsx         # Same shape as login + success state (~480 lines)
│   │   ├── auth/callback/route.ts  # OAuth/email-confirm code exchange
│   │   └── api/
│   │       ├── ingest/route.ts     # POST — Zapier/manual paste webhook (admin client, no auth)
│   │       ├── latest-plan/route.ts # GET — single plan by session_date
│   │       ├── sessions/route.ts   # GET — last 90 sessions for date navigator
│   │       ├── trades/route.ts     # GET (date or last N days) + POST (insert)
│   │       ├── trades/[id]/route.ts # PATCH + DELETE
│   │       ├── tldr/route.ts       # GET — cached TL;DR or lazy-generate
│   │       ├── es-price/route.ts   # GET — Yahoo Finance ES=F with 10s in-memory cache
│   │       └── health/route.ts     # GET — { status, supabase: !!env }
│   ├── components/
│   │   ├── LevelLadder.tsx         # Vertical price ladder with S/R levels (~149 lines)
│   │   ├── GamePlan.tsx            # Bull/bear paths + trigger cards + FB setup cards (~226 lines)
│   │   ├── TldrTab.tsx             # Right-panel TL;DR view (~149 lines)
│   │   ├── TradeLog.tsx            # TradeBar / TradeStats / NewTradeModal / EditTradeModal (~499 lines, 4 exports)
│   │   └── PasteModal.tsx          # Paste email → preview → apply (~73 lines)
│   ├── hooks/
│   │   └── useESPrice.ts           # Polling hook over /api/es-price (15s interval)
│   ├── lib/
│   │   ├── parser.ts               # parseLevels() + calculatePnL() — pure, regex-based
│   │   ├── generate-tldr.ts        # OpenAI gpt-5.5 → TldrData; writes back to plans.tldr
│   │   ├── supabase-browser.ts     # createBrowserSupabase() — anon, client components
│   │   ├── supabase-server.ts      # createServerSupabase() (cookie/RLS) + createAdminSupabase() (service role)
│   │   ├── types.ts                # Level, Plan, Trade, ParsedPlan, Session
│   │   └── tldr-types.ts           # TldrData, TldrStat, TldrInsight, TldrSection, FbSetup
│   └── middleware.ts               # Auth gating + session refresh on every non-static request
├── public/                         # Logos, favicons, marketing/static docs (.md files at the root of /public)
│   ├── API.md                      # Static markdown — served as a static asset, not imported
│   ├── ARCHITECTURE.md
│   ├── BUSINESS.md
│   ├── DEVELOPMENT.md
│   ├── PRODUCT.md
│   ├── apple-touch-icon.png
│   ├── favicon-192.png / favicon-512.png / favicon.ico
│   ├── logo.png / logo-full.png / logo-wide.svg / logo.svg
├── docs/                           # (empty / no files seen during scan)
├── schema.sql                      # Initial table DDL (stale — no user_id, no tldr column)
├── migrate-multi-tenant.sql        # Adds user_id + RLS policies + indexes
├── migrate-session-date.sql        # Adds + backfills session_date
├── package.json                    # 7 prod deps, 5 dev deps, scripts: dev / build / start
├── package-lock.json
├── next.config.ts                  # serverExternalPackages: ["yahoo-finance2", "openai"]
├── postcss.config.mjs              # @tailwindcss/postcss only
├── tsconfig.json                   # strict, ES2017, @/* alias to ./src/*
├── tsconfig.tsbuildinfo            # Build cache (115 KB) — committed; should be gitignored
├── .env.example                    # 3 vars (Supabase) — missing OPENAI_API_KEY
├── .gitignore                      # node_modules, .next, .env, .env.local, .DS_Store, .claude, next-env.d.ts
└── CLAUDE.md
```

## Directory Purposes

**`src/app/`** — Next.js App Router root.
- Top level holds the dashboard page, root layout, and global stylesheet.
- Auth UI (`login`, `signup`) and OAuth callback (`auth/callback`) live here as siblings.
- All HTTP API endpoints sit under `src/app/api/<resource>/route.ts` (Next 15 convention).

**`src/components/`** — Shared client components consumed by `page.tsx`.
- Flat (no nesting), one file per visual block. `TradeLog.tsx` is the exception: a single file exporting four named components (`TradeBar`, `TradeStats`, `NewTradeModal`, `EditTradeModal`).
- All marked `"use client"`.

**`src/hooks/`** — Custom React hooks. Currently one file (`useESPrice.ts`).

**`src/lib/`** — Pure-ish modules with no React. Parser, P&L math, types, OpenAI call, Supabase client factories.

**`src/middleware.ts`** — Single edge middleware for the whole app.

**`public/`** — Static assets served at root. Note: contains five `.md` files (`API.md`, `ARCHITECTURE.md`, `BUSINESS.md`, `DEVELOPMENT.md`, `PRODUCT.md`) that look like they were intended to be served as static docs from `/API.md`, etc. They are NOT imported into the app and shouldn't be confused with the docs we're writing into `.planning/codebase/`.

**`docs/`** — Present but empty (per directory listing).

**Project root SQL files** — These are run by hand in the Supabase dashboard. There is no migrations runner (no `supabase/migrations/` directory, no Drizzle/Prisma/Knex). Order of application is implicit: `schema.sql` first, then `migrate-session-date.sql`, then `migrate-multi-tenant.sql`. **`schema.sql` itself does not match the live schema** — it lacks `user_id` (added in the multi-tenant migration) and `tldr` JSONB (referenced by `app/api/ingest/route.ts:34` and `lib/generate-tldr.ts:155` but not declared in any committed SQL file).

## Key File Locations

**Entry Points:**
- `src/app/page.tsx`: Dashboard (`/`)
- `src/app/login/page.tsx`, `src/app/signup/page.tsx`: Public auth UI
- `src/middleware.ts`: Request gate

**Configuration:**
- `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `.env.example`

**Core Logic:**
- `src/lib/parser.ts`: Email parsing + P&L
- `src/lib/generate-tldr.ts`: OpenAI orchestration
- `src/lib/supabase-server.ts` / `supabase-browser.ts`: Client factories
- `src/app/api/ingest/route.ts`: Webhook
- `src/app/api/tldr/route.ts`: AI summary read-through cache

**Schema / Data:**
- `schema.sql` (incomplete), `migrate-multi-tenant.sql`, `migrate-session-date.sql`

**Testing:**
- None — no test directory, no test runner, no test scripts

## Naming Conventions

**Files:**
- Components: `PascalCase.tsx` (`LevelLadder.tsx`, `TradeLog.tsx`)
- Routes: `kebab-case` directories with `route.ts` files (`latest-plan/route.ts`, `es-price/route.ts`); dynamic params use Next bracket syntax (`trades/[id]/route.ts`)
- Library modules: `kebab-case.ts` (`generate-tldr.ts`, `tldr-types.ts`, `supabase-browser.ts`)
- Hooks: `useCamelCase.ts` (`useESPrice.ts`)
- Pages: lowercase folder + `page.tsx`

**Directories:**
- All lowercase, kebab where multi-word

**Code:**
- React components: PascalCase
- Functions and vars: camelCase
- Type/interface names: PascalCase (see `src/lib/types.ts`, `src/lib/tldr-types.ts`)
- CSS: terse hand-rolled class names (`hdr`, `hdr-pnl`, `tc`, `tabs`, `mo`, `md w`, `btn b-d`) — opaque without reading `globals.css`
- Database columns: `snake_case` (`session_date`, `email_date`, `exit_75_price`, `point_value`)

## Where to Add New Code

**New API endpoint:** `src/app/api/<resource>/route.ts`
- Use `createServerSupabase()` from `lib/supabase-server.ts` for user-scoped reads/writes (RLS handles authorization)
- Use `createAdminSupabase()` only for service-role tasks (avoid by default)
- Wrap in `try/catch`, log with `console.error`, return `NextResponse.json({ error: "..." }, { status: ... })`
- If the endpoint should be reachable unauthenticated, **add the path to the `publicPaths` array in `src/middleware.ts:31`** — otherwise middleware will redirect to `/login`

**New dashboard tab/section:**
- Add a component in `src/components/`
- Wire it into the `TABS` const + `TAB_LABELS` map at `src/app/page.tsx:20-27`
- Render it inside the `.tc` container's tab switch (`page.tsx:359-376`)

**New shared component:** `src/components/PascalCase.tsx`, marked `"use client"` if it uses hooks/events

**New parsing or pure-math helper:** add to `src/lib/parser.ts` (or a new `src/lib/<thing>.ts` if it doesn't fit), keep it free of React imports so it can be called from both client and server

**New hook:** `src/hooks/useThing.ts`

**New type:** Extend `src/lib/types.ts` (domain) or `src/lib/tldr-types.ts` (LLM output schema)

**New table column:**
1. Add the column in a new `migrate-<change>.sql` at repo root
2. Run it manually in the Supabase SQL editor
3. Update `schema.sql` to match (currently divergent — fix when touching it)
4. Update the relevant interface in `src/lib/types.ts`

**New static page:** `src/app/<slug>/page.tsx`

**New env var:**
1. Add to `.env.example`
2. Read via `process.env.X` server-side, or `process.env.NEXT_PUBLIC_X` if it must reach the browser
3. If the missing-var case should fail loudly, add an explicit guard (current pattern is `process.env.X!` non-null assertion in Supabase factories, vs. soft-fail in `lib/generate-tldr.ts:105`)

## Special Directories

**`public/*.md`** — Served as static assets at the root URL (e.g. `/API.md`). Not imported by the app. Distinct from `.planning/codebase/*.md`.

**`.claude/`** — Gitignored agent state; this scan runs from a worktree under it.

**`.planning/codebase/`** — Output target for these scans. Consumed by other GSD commands.

**`tsconfig.tsbuildinfo`** — TypeScript incremental build cache. Committed but shouldn't be; safe to delete and add to `.gitignore`.

---

*Structure analysis: 2026-05-04*

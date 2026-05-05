<!-- generated-by: gsd-doc-writer -->
# Architecture

## 1. High-level overview

TradeLadder is a single-tenant-feeling SaaS web app for ES futures traders, built as a
Next.js 15 App Router application (TypeScript, React 19) deployed to Render. State lives in
Supabase Postgres with Row Level Security (RLS) scoping every row to its owning user.
Server-only secrets (the Supabase service key and the OpenAI key) drive two side channels:
OpenAI `gpt-5.5` produces a structured TL;DR + thesis headline from each pasted Mancini
email, and `yahoo-finance2` fetches a live ES=F quote that is cached in a singleton
Postgres row (`es_price_cache`). Auth is Supabase Auth (email/password + Google OAuth);
the only public surfaces are `/login`, `/signup`, `/auth/callback`, and `/api/health` —
everything else is gated by `src/middleware.ts`.

## 2. Request lifecycle

```
                 ┌────────── browser ───────────┐
                 │  Dashboard (page.tsx)         │
                 │  hooks: useAuth, useSessions, │
                 │   useParsedPlan, useTrades,   │
                 │   useESPrice, useManualPrice  │
                 └──────────────┬────────────────┘
                                │ fetch(/api/...)
                                ▼
              ┌─────────── middleware.ts ──────────┐
              │ supabase.auth.getUser() (cookies)  │
              │ public allowlist: /login /signup   │
              │   /auth/callback /api/health       │
              │ unauth → 302 /login                │
              └──────────────┬─────────────────────┘
                             │ authenticated
                             ▼
       ┌────── Next.js route handler (src/app/api/.../route.ts) ──────┐
       │  createServerSupabase() — RLS-scoped to req user             │
       │  createAdminSupabase() — service role, RLS-bypassing         │
       └─────────┬───────────────┬───────────────┬───────────────┬────┘
                 │               │               │               │
                 ▼               ▼               ▼               ▼
          Supabase PG    OpenAI gpt-5.5   Yahoo Finance    es_price_cache
          (plans,        (TL;DR JSON +    (ES=F quote)     (singleton row,
           trades,       headline)                          60s TTL)
           es_price_
           cache)
```

`instrumentation.ts` runs `assertEnv()` once at server boot and crashes the process if any
required env var is missing, so the request pipeline above never sees a half-configured
runtime.

## 3. Component topology

`src/app/page.tsx` is a thin shell (~180 LOC after the F1 refactor). All data fetching and
state lives in co-located hooks; the page wires their outputs into presentational pieces:

```
page.tsx (Dashboard)
├── Header                    ← date nav, thesis, ES price input, P&L, sign-out
├── <main>
│   ├── ErrorBoundary("Level Ladder")
│   │   └── LevelLadder       ← supports/resistances list, current price band
│   └── <section class="rp">
│       ├── tab buttons
│       ├── ErrorBoundary("Game Plan")  → GamePlan
│       ├── ErrorBoundary("Trade Stats") → TradeStats
│       └── ErrorBoundary("TL;DR")      → TldrTab
├── TradeBar                  ← bottom bar: open trades + "+ New" button
├── PasteModal                ← email-paste UI
├── NewTradeModal / EditTradeModal
```

Every dashboard tab is wrapped in `<ErrorBoundary>` (`src/components/ErrorBoundary.tsx`,
class component) so a render bug in, say, the parsed Game Plan does not blank the whole
app — the user can still see the Level Ladder and the Trade Log.

## 4. Hooks layer

All hooks live in `src/hooks/` and each owns a tight slice of state. They are composed
inside `page.tsx` only.

| Hook | State owned | Fetches | Notes |
|---|---|---|---|
| `useAuth` | `userEmail`, `userId` | `supabase.auth.getUser()` (browser client) | Provides `signOut()` which routes to `/login`. |
| `useSessions` | `sessions[]`, `sessionDate`, nav state | `GET /api/sessions` | `navigate("older"/"newer")` walks the sorted-newest-first list. Comment in source explains why direction names beat ±1 indexing. |
| `useParsedPlan` | `parsed`, `headline` | `GET /api/latest-plan?date=`, `GET /api/tldr?date=`, `POST /api/ingest` | `ingestPaste()` runs the parser locally, posts to ingest, then polls `/api/tldr` up to ~30s for the headline. A `justPastedDateRef` skips the next fetch to avoid a paste→clear race. |
| `useTrades` | `trades[]` | `GET /api/trades?date=`, `DELETE /api/trades/[id]` | Optimistic local mutations via `createTrade`/`updateTrade`/`deleteTrade`. |
| `useESPrice` | `price`, `change`, `marketState`, `isStale` | `GET /api/es-price` every 15s | Marks stale on network errors but keeps last known price. |
| `useManualPrice` | `manualPriceStr`, `manualOverride`, `currentPrice`, `priceSource` | none | Pure derivation over `useESPrice`. Manual override beats live; both beat zero. |

`computePnL(trades, currentPrice)` in `src/lib/pnl.ts` is a pure function called directly
from `page.tsx` — no hook wrapper.

## 5. API routes

All routes live under `src/app/api/`. Default auth model: middleware forces a Supabase
session on every non-public path before the handler runs, so route handlers can call
`createServerSupabase()` and rely on RLS.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/health` | GET | **Public** | Returns `{ ok, checks }` for env presence, Supabase round-trip, and `es_price_cache` freshness. 200 if all green, 503 otherwise. UptimeRobot (F8a) target. |
| `/api/ingest` | POST | **Session-authenticated** (F2) | Parses pasted email, upserts a `plans` row keyed on `(user_id, session_date)` via the admin client, fires `generateTldr` async. `user_id` is read from the cookie session — never the body. |
| `/api/latest-plan` | GET | Session | Returns the most recent `plans` row for the requesting user, optionally filtered by `?date=`. |
| `/api/sessions` | GET | Session | Lists up to 90 most recent `(session_date, subject)` pairs for the user. |
| `/api/trades` | GET | Session | Returns trades for `?date=` or, if absent, the last `?days=` (default 30). |
| `/api/trades` | POST | Session | Inserts a trade. If `idempotency_key` is present and a row already exists for `(user_id, key)`, returns the existing row — F10 dedup. |
| `/api/trades/[id]` | PATCH | Session | Updates a trade. RLS ensures cross-user updates fail. |
| `/api/trades/[id]` | DELETE | Session | Deletes a trade. RLS ensures cross-user deletes fail. |
| `/api/tldr` | GET | Session | Reads cached `plans.tldr` for `?date=`. If null, generates synchronously via `generateTldr` and saves. |
| `/api/es-price` | GET | Session | Reads `es_price_cache` singleton; if older than 60s, refreshes from Yahoo and upserts. Falls back to stale cache on Yahoo failures. |

Note: `/api/ingest` no longer requires an admin key. The Resend inbound-email path
(planned Phase 4) will land at `/api/inbound-email` with its own webhook signature
validation — see `middleware.ts` for the public-allowlist comment that documents this.

## 6. Database schema

Canonical schema is `schema.sql` (root). Migrations applied chronologically: session_date
→ multi-tenant + RLS → trade idempotency (F10) → es_price_cache (F6).

**`plans`** — one row per Mancini email per user.
- `id uuid PK`, `user_id uuid → auth.users`, `session_date date`, `email_date text`,
  `subject text`, `body text`, `tldr jsonb` (TldrData), `created_at timestamptz`
- Indexes: `user_id`, `session_date desc`, `created_at desc`
- RLS: select/insert/delete policies all `auth.uid() = user_id`. No update policy —
  ingest uses the admin client to upsert on `(user_id, session_date)`.

**`trades`** — one row per logged trade.
- `id uuid PK`, `user_id uuid → auth.users`, `session_date date`, `symbol text`,
  `direction` (long/short check), `contracts int`, `entry_price numeric`,
  `exit_75_price numeric?`, `exit_runner_price numeric?`,
  `setup_type text` (enum check), `point_value numeric`, `notes text?`, `pnl numeric?`,
  `idempotency_key text?`, `created_at timestamptz`
- Partial unique index `trades_user_idempotency_idx` on `(user_id, idempotency_key)`
  where `idempotency_key is not null` — F10 dedup.
- RLS: full select/insert/update/delete, all gated on `auth.uid() = user_id`.

**`es_price_cache`** (F6) — singleton row (`id = 1` check constraint). Holds the latest
ES=F quote: `price`, `change`, `change_percent`, `market_state`, `updated_at`. RLS is
enabled with **no policies**, so only the service role can read or write it. Replaces the
previous module-level in-memory cache so Render cold starts and horizontal instances
share state.

Planned but **not in current schema**: `level_corrections` (E5). Intended to capture
human edits to parser output for retraining; will land alongside Phase 5.

## 7. Env + boot

`src/lib/env.ts` declares `assertEnv()` (throws on missing keys) and `envStatus()`
(returns booleans, used by `/api/health`). `src/instrumentation.ts` is the
Next.js-native boot hook:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
  }
}
```

The lazy import is deliberate: `next build` does not set `NEXT_RUNTIME`, so build-time
env is not validated, only **runtime** env. Required keys (see `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `OPENAI_API_KEY`

Phase 4 will add `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. F9/F12 will add
`ADMIN_USER_IDS` and `ADMIN_PITCH_TOKEN_SECRET`. Both groups are commented placeholders
in `.env.example`.

## 8. Error boundaries

Three layers, outermost first:

1. **`src/app/global-error.tsx`** — last resort. Declares its own `<html><body>` because
   the root layout itself failed. Inline-styled (no globals.css available).
2. **`src/app/error.tsx`** — App Router route-level boundary. Catches errors that escape
   the per-tab boundaries: middleware, layout, server-component renders. Shows a
   "Try again" button that calls `reset()`.
3. **`<ErrorBoundary>`** (`src/components/ErrorBoundary.tsx`) — class component, used per
   tab in `page.tsx` (`label="Level Ladder"`, `"Game Plan"`, `"Trade Stats"`, `"TL;DR"`).
   A render bug in one tab does not blank the rest of the dashboard.

All three boundaries `console.error` so Render logs capture the underlying stack.

## 9. Caching strategies

- **`es_price_cache` (60s TTL, persistent)** — `src/app/api/es-price/route.ts:6` defines
  `CACHE_TTL_MS = 60_000`. Reads the singleton row first; only hits Yahoo on a miss or
  stale row. The Supabase upsert is intentionally **not awaited** so client latency is
  the cost of one Yahoo call, not Yahoo + a DB write. On Yahoo failure (timeout, cookie
  wall, rate-limit) the route falls back to the stale row marked `stale: true` so the UI
  keeps a recent frame.
- **TL;DR cached on the plan row** — `plans.tldr jsonb`. `/api/tldr` returns the cached
  value if present; otherwise runs `generateTldr(planId, body)` synchronously and stores
  the result. `/api/ingest` always nulls `tldr` on upsert and fires generation
  asynchronously (`generateTldr(...).catch(console.error)`), so a paste does not block
  on OpenAI. The client polls `/api/tldr` up to ~30s in `useParsedPlan.pollTldr` to
  pick up the headline.
- **LLM parser cache (planned)** — once Phase 5 swaps `parser.ts` for an OpenAI parser,
  output will be cached by `(email_hash, parser_version)` so a re-run with the same
  email and same prompt version is free.

## 10. Auth flow

Supabase Auth is the only auth backend. Two providers are wired:

- **Email/password** — `src/app/login/page.tsx` calls
  `supabase.auth.signInWithPassword()`. Signup is at `/signup`.
- **Google OAuth** — `signInWithOAuth({ provider: "google", options: { redirectTo:
  $origin/auth/callback }})`. The callback handler at
  `src/app/auth/callback/route.ts` exchanges the code for a session. It honors
  `x-forwarded-host`/`x-forwarded-proto` so Render's internal proxy origin doesn't break
  the redirect.

`src/middleware.ts` runs on every non-static route (the matcher excludes `_next/static`,
`_next/image`, image extensions, and `favicon.ico`). It calls
`supabase.auth.getUser()` which, importantly, refreshes the session cookies on every
hit — that's why the middleware is the only place sessions get rolled forward.

Public allowlist: `/login`, `/signup`, `/auth/callback`, `/api/health`. Logged-in users
hitting `/login` or `/signup` get redirected to `/`; unauth users hitting anything else
get redirected to `/login`.

## 11. External integrations

- **Supabase** — Postgres + Auth + RLS. Three clients: `createBrowserSupabase`
  (publishable key, used in `"use client"` components), `createServerSupabase` (anon key
  + cookies, RLS-scoped, used in route handlers), `createAdminSupabase` (service key,
  RLS-bypassing, used for ingest upsert and `es_price_cache`/health checks).
- **OpenAI** — `openai@^4.79`. Model `gpt-5.5` with `reasoning_effort: "high"` and
  `response_format: { type: "json_object" }`. Single call site:
  `src/lib/generate-tldr.ts`. Phase 5 will add `/api/parse-plan` for level extraction.
- **yahoo-finance2** — `^3.14`, called only from `/api/es-price`. Configured in
  `next.config.ts` as a `serverExternalPackages` entry along with `openai` so
  Next does not bundle them.
- **Render** — hosting. Deploy on push to GitHub `main`. Build: `npm install && npm run
  build`. Start: `npm start`. <!-- VERIFY: Render plan/instance type and exact build configuration -->
- **Resend (planned)** — Phase 4. Will deliver inbound Mancini emails to
  `/api/inbound-email`. Auth via webhook signature, not the user session.

## 12. Open architectural items

- **Phase 4 — Resend inbound** — replace the manual paste path with an inbound webhook
  at `/api/inbound-email`. Adds `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET`. The middleware
  allowlist comment already names this route.
- **Phase 5 — LLM parser** — `src/lib/parser.ts` is regex-based and brittle to format
  drift. Replace with an OpenAI parser at `/api/parse-plan`, cached by
  `(email_hash, parser_version)`. Adds the `level_corrections` table for human-edit
  feedback.
- **F8a — UptimeRobot** — wire UptimeRobot (or equivalent) to hit `/api/health` every
  5 min and page on non-200. The route is shaped to support this.
- **F8b — pg_cron pre-warmer** — schedule a Supabase `pg_cron` job that pre-fills
  `es_price_cache` on a market-hours cadence so the first user hit of the day never
  blocks on Yahoo. The health check's "5 min cache age" threshold doubles as a sanity
  signal that this job is healthy.

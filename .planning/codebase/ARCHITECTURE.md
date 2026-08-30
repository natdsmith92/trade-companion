# Architecture

**Analysis Date:** 2026-05-04

## Pattern Overview

**Overall:** Single-page Next.js 15 App Router dashboard with thin REST-style API routes and a Postgres+RLS backend.

**Key Characteristics:**
- One client component (`src/app/page.tsx`, 410 lines) owns essentially all dashboard state and orchestrates child components and API calls
- Server-side concerns (auth, ingestion, persistence, AI summarization, market data) live in route handlers under `src/app/api/*/route.ts` and are stateless except for one module-level price cache
- Three Supabase clients with distinct trust levels: browser (anon, RLS), server-cookie (anon, RLS, user-scoped), admin (service role, bypasses RLS, used only by the webhook and the TL;DR write-back)
- Multi-tenant via Postgres RLS, not application-layer filtering: routes never `.eq("user_id", ...)` because the cookie-authed Supabase client enforces it via policies (`migrate-multi-tenant.sql:15-41`)

## Layers

**Presentation (Client Components):**
- Purpose: Dashboard UI, paste/edit modals, live price + P&L rendering
- Location: `src/app/page.tsx`, `src/components/*.tsx`, `src/app/login/page.tsx`, `src/app/signup/page.tsx`
- Contains: React functional components with hooks, hand-rolled CSS via `globals.css`
- Depends on: Browser Supabase client, `/api/*` routes via `fetch`, `parseLevels` (also imported client-side)
- Used by: User browsers

**API / Route Handlers (Server):**
- Purpose: HTTP entry points for the SPA and Zapier
- Location: `src/app/api/*/route.ts`
- Contains:
  - `ingest/route.ts` — POST, public, admin client, parses + upserts plan, fires TL;DR
  - `latest-plan/route.ts` — GET, server-cookie client, RLS-scoped fetch by `session_date`
  - `sessions/route.ts` — GET, server-cookie client, last 90 sessions for date navigator
  - `trades/route.ts` — GET (by date or last N days) + POST (insert with `user_id`)
  - `trades/[id]/route.ts` — PATCH + DELETE, RLS-scoped
  - `tldr/route.ts` — GET; returns cached `plans.tldr` if present, otherwise synchronously calls `generateTldr`
  - `es-price/route.ts` — GET, no auth needed at the data layer (just middleware-gated), Yahoo Finance + 10s in-memory cache
  - `health/route.ts` — GET, returns `{ status, supabase: !!env }`
- Depends on: `lib/supabase-server.ts`, `lib/parser.ts`, `lib/generate-tldr.ts`, `yahoo-finance2`
- Used by: Browser SPA (`src/app/page.tsx`), Zapier (ingest), uptime checks (health)

**Domain Logic (lib):**
- Purpose: Pure parsing, P&L math, AI orchestration, type definitions
- Location: `src/lib/`
- Files:
  - `parser.ts` — `parseLevels()`, `calculatePnL()` (75/25 split runner math, see `parser.ts:177-200`)
  - `generate-tldr.ts` — Orchestrates OpenAI call + DB write-back (`generate-tldr.ts:101-171`)
  - `types.ts` — `Level`, `Plan`, `Trade`, `ParsedPlan`, `Session`
  - `tldr-types.ts` — `TldrData`, `TldrStat`, `TldrInsight`, `TldrSection`, `FbSetup`
  - `supabase-browser.ts` / `supabase-server.ts` — client factories
- Depends on: openai SDK, supabase clients
- Used by: API routes, page.tsx (parseLevels is also called on the client to render previews and to re-parse `data.body` after fetch)

**Edge / Middleware:**
- Purpose: Auth gating + cookie session refresh on every non-static request
- Location: `src/middleware.ts`
- Public paths: `/login`, `/signup`, `/auth/callback`, `/api/ingest`, `/api/health` (`middleware.ts:31`)
- Matcher excludes Next internals + image extensions (`middleware.ts:53-55`)

**Data:**
- Supabase Postgres
- Tables: `plans`, `trades` (see STRUCTURE.md and INTEGRATIONS.md)
- Constraints enforced at the DB layer: `direction in ('long','short')`, `setup_type in ('Failed Breakdown','Flag','Trendline','Other')` (`schema.sql:21-26`)
- Indexes on `session_date desc`, `created_at desc`, and `user_id` (`schema.sql:33-36`, `migrate-multi-tenant.sql:48-49`)

## Data Flow

### Plan ingestion (Zapier path)

1. Adam Mancini sends his daily email; Gmail filter triggers a Zapier zap
2. Zapier POSTs `{ date, subject, body, user_id }` to `/api/ingest` (`app/api/ingest/route.ts:9-11`)
3. `parseLevels(body, subject)` extracts supports, resistances, lean, bull/bear targets, triggers, and a `sessionDate` (`parser.ts:10-24`)
4. `createAdminSupabase()` upserts into `plans` keyed on `(user_id, session_date)`, clearing `tldr` so it regenerates (`route.ts:25-39`)
5. `generateTldr(data.id, body)` is fired without `await` (`route.ts:49`) — calls OpenAI (`gpt-5.5`), parses JSON, writes back to `plans.tldr` (`generate-tldr.ts:113-157`)
6. Webhook returns `{ status: "ok", id, session_date }` immediately; TL;DR fills in async

### Plan ingestion (manual paste path)

1. User opens `PasteModal` (`src/components/PasteModal.tsx`) and pastes email
2. Client-side `parseLevels(text)` runs immediately for preview (`page.tsx:121`)
3. On Apply, client POSTs to `/api/ingest` with its own `userId` (`page.tsx:126-135`)
4. Same server path as Zapier from there
5. Client refetches `/api/sessions` so the date navigator picks up the new session (`page.tsx:140-143`)

### Dashboard load

1. `page.tsx` mounts → `createBrowserSupabase().auth.getUser()` populates `userEmail`/`userId` (`page.tsx:54-61`)
2. `GET /api/sessions` returns last 90 sessions; latest selected as `sessionDate` (`page.tsx:71-79`)
3. `loadSession(date)` fires three parallel fetches (`page.tsx:82-106`):
   - `GET /api/latest-plan?date=…` → body is re-parsed client-side via `parseLevels` to render `LevelLadder`/`GamePlan`
   - `GET /api/trades?date=…` → list for `TradeBar`/`TradeStats`
   - `GET /api/tldr?date=…` → just the `headline` is hoisted into the header; full TL;DR is loaded by `TldrTab` only when its tab is active (`TldrTab.tsx:22-40`)
4. `useESPrice` hook polls `GET /api/es-price` every 15s (`useESPrice.ts:15, 56-60`); server caches the upstream call for 10s (`es-price/route.ts:22`)

### Live P&L computation

1. `page.tsx:174-198` walks all trades for the session
2. Realized P&L = `t.pnl ?? 0` (server-stored at insert/update time via `calculatePnL` in `TradeLog.tsx`)
3. Unrealized P&L = open runner leg (`exit_75_price && !exit_runner_price`) or fully-open trade, priced at `currentPrice = manual override ?? esPrice.price`
4. Header shows split realized/open badges when any unrealized exists (`page.tsx:308-320`)

### Trade lifecycle

1. `NewTradeModal` (in `src/components/TradeLog.tsx`) POSTs to `/api/trades`; route attaches `user_id` from the cookie session (`app/api/trades/route.ts:39-46`)
2. `EditTradeModal` PATCHes `/api/trades/[id]` — RLS guarantees the row belongs to the caller (`app/api/trades/[id]/route.ts:11-16`)
3. Delete via `DELETE /api/trades/[id]`; client filters from local state (`page.tsx:149-157`)

## Key Abstractions

**Three-tier Supabase client (`src/lib/supabase-server.ts`, `src/lib/supabase-browser.ts`):**
- `createBrowserSupabase()` — anon, used in client components
- `createServerSupabase()` — anon + cookie store, used in authed API routes; `await cookies()` (Next 15 async cookies API)
- `createAdminSupabase()` — service role, **only** in `/api/ingest` and the TL;DR write-back. Bypasses RLS, so callers must explicitly pass `user_id`.

**Plan parser (`src/lib/parser.ts`):**
- Format-tolerant regex extraction of "Supports are: X, Y (major), …", ranges like `6778-82`, lean phrases, scenario targets, if/then trigger lines, and date strings like "April 22" or "4/22"
- `extractScenarioTargets` filters numbers to the 3000–20000 range as a sanity check (`parser.ts:145-147`) — will need updating if ES futures ever trade outside that band
- `calculatePnL(direction, entryPrice, exit75Price, exitRunnerPrice, contracts, pointValue)` implements the 75/25 partial-exit split (`parser.ts:177-200`)

**TL;DR pipeline (`src/lib/generate-tldr.ts`):**
- Hard-coded `SYSTEM_PROMPT` (lines 5–99) defines the JSON schema the model must return: `headline`, 3 `stats`, 4 `sections`, `fbSetups[]`
- Validates that `stats` and `sections` are arrays before accepting (`generate-tldr.ts:137-140`)
- Caches in `plans.tldr` JSONB; the GET endpoint at `/api/tldr` will lazily generate on cache miss (`app/api/tldr/route.ts:27-35`)

**Live price hook (`src/hooks/useESPrice.ts`):**
- 15s `setInterval` polling, returns `{ price, change, changePercent, marketState, isLive, isStale, lastUpdate }`
- Keeps last good price in a ref and marks `isStale` on network errors instead of clearing (`useESPrice.ts:50-53`)

**Tabbed dashboard (`src/app/page.tsx`):**
- 3 tabs: `plan` → `<GamePlan>`, `trades` → `<TradeStats>`, `tldr` → `<TldrTab>` (`page.tsx:20, 359-376`)
- Persistent layout: header, `<LevelLadder>` on the left, right panel with tabs, `<TradeBar>` at bottom
- Note: `CLAUDE.md` says "3 tabs" — actual code matches, but the labels include `TL;DR` (not mentioned in CLAUDE.md as a tab)

## Entry Points

**HTTP:**
- `src/app/page.tsx` — dashboard (`/`), client component
- `src/app/login/page.tsx` (`/login`), `src/app/signup/page.tsx` (`/signup`) — auth UI, client components
- `src/app/auth/callback/route.ts` — OAuth/email-confirm exchange, server route
- `src/app/api/*/route.ts` — REST endpoints

**Webhook:**
- `POST /api/ingest` (Zapier)

**Background:**
- None. No cron, no queue, no scheduled functions. The fire-and-forget `generateTldr(...)` in `app/api/ingest/route.ts:49` is the only async post-response work.

## Error Handling

**Strategy:** Try/catch at every route boundary; log via `console.error`; return `{ error: "..." }` JSON with appropriate status (400/401/404/500/502/503).

**Patterns:**
- Webhook returns 400 on missing `body` or `user_id` (`app/api/ingest/route.ts:13-19`)
- Trades POST returns 401 if `auth.getUser()` is null (`app/api/trades/route.ts:39-42`)
- TL;DR returns 404 if no plan exists, 503 if generation failed (`app/api/tldr/route.ts:22, 37-40`)
- ES price returns stale cache with `stale: true`, or 502 if cache is empty (`es-price/route.ts:46-52`)
- Client-side: most fetches use `.catch(() => {})` to silently degrade (`page.tsx:78, 96, 105, 146, 155`); errors render as inline placeholders (e.g. `parsed?.lean || "Paste an email…"`, `page.tsx:249`)

## Cross-Cutting Concerns

**Authentication:**
- Cookie-based via `@supabase/ssr`; refreshed on every middleware run (`middleware.ts:26-28`)
- Public-path allowlist explicit in middleware (`middleware.ts:31`)

**Authorization:**
- Postgres RLS on `plans` / `trades`. Application code never filters by `user_id` for the user-facing routes — RLS does it (`migrate-multi-tenant.sql:15-41`)
- The admin client at `lib/supabase-server.ts:31` is the only RLS bypass and is only imported by `app/api/ingest/route.ts` and `lib/generate-tldr.ts`

**Logging:** `console.log` for happy-path ingestion (`route.ts:46`, `generate-tldr.ts:163`), `console.error` for everything else. No request IDs, no structured logs.

**Validation:** No schema validator (no Zod / Valibot / Yup). API routes destructure JSON bodies and rely on DB constraints + TS types. The TL;DR pipeline does shape-checking by hand (`generate-tldr.ts:137-140`).

**State management:** Local React state in `page.tsx` only. No Redux/Zustand/Jotai/Context. Server state is fetched ad-hoc with `fetch`; no SWR / TanStack Query. Refetches are done manually after mutations.

---

*Architecture analysis: 2026-05-04*

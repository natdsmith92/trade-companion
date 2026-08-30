<!-- generated-by: gsd-doc-writer -->
# Configuration

Every knob the app cares about. The repo treats env validation as a hard boot
gate — `src/instrumentation.ts` calls `assertEnv()` on Node startup and the
process crashes if any of the four required keys are missing, instead of each
route handler discovering it on first request.

## Required Environment Variables

Defined in [`.env.example`](../.env.example) and validated by
[`src/lib/env.ts`](../src/lib/env.ts) (the `REQUIRED` array, lines 13-18).

| Variable | What it's for | Where it's used |
|----------|---------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser + server). | `src/lib/supabase-browser.ts`, `src/lib/supabase-server.ts:9,33` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key — RLS-bound, used in browser & SSR cookie client. | `src/lib/supabase-browser.ts`, `src/lib/supabase-server.ts:10` |
| `SUPABASE_SERVICE_KEY` | Service-role key — **bypasses RLS**. Used only server-side for the admin client. | `src/lib/supabase-server.ts:34` (`createAdminSupabase`) |
| `OPENAI_API_KEY` | OpenAI credential for TL;DR generation. | `src/lib/generate-tldr.ts:107` |

**Failure mode when missing:** `assertEnv()` in `src/lib/env.ts:21-28` throws

```
Missing required env: <names>. See .env.example for the full list.
The server cannot start without these.
```

`instrumentation.ts` only calls `assertEnv()` when `NEXT_RUNTIME === "nodejs"`,
so `next build` (which doesn't set that variable) succeeds without env present.
This is intentional — the build container does not need real keys.

## Optional Environment Variables

All commented out in [`.env.example`](../.env.example) (lines 8-14). Reserved
for upcoming phases; nothing in `src/` reads them yet.

| Variable | Phase | Purpose |
|----------|-------|---------|
| `RESEND_API_KEY` | Phase 4 inbound email | Outbound email via Resend; will be wired into the Phase 4 inbound webhook auth flow. |
| `RESEND_WEBHOOK_SECRET` | Phase 4 inbound email | HMAC secret for verifying Resend's signed webhook deliveries to `/api/inbound-email`. |
| `ADMIN_USER_IDS` | F9 admin gate | Comma-separated list of UUIDs allowed into `/admin/pitch`. |
| `ADMIN_PITCH_TOKEN_SECRET` | F12 tokenized share URLs | HMAC secret used to sign tokenized share URLs from the admin panel. |

When the corresponding feature lands, uncomment the line in `.env.example`,
add the var to Render, and update `REQUIRED` in `src/lib/env.ts` if the feature
should hard-fail on missing config.

## package.json Scripts

[`package.json`](../package.json) lines 5-9:

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `next dev` | Local dev server with HMR. Defaults to `http://localhost:3000`. |
| `build` | `next build` | Production build. Skips `assertEnv()` (see above). |
| `start` | `next start` | Production server. Render uses this as the start command. |

There is **no test or lint script defined** at this point. Type checking is
implicit via `tsc` during `next build` (TypeScript `noEmit: true`). Adding
`test` / `lint` scripts is a known gap.

## next.config.ts

[`next.config.ts`](../next.config.ts):

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2", "openai"],
};
```

`serverExternalPackages` tells Next.js not to attempt to bundle these packages
into the server build — they stay as runtime `require()`s from `node_modules`.
Both packages ship CommonJS / native bits that don't bundle cleanly through
the Next.js server-component compiler, so they have to be excluded.

## TypeScript Config

See [`tsconfig.json`](../tsconfig.json). Key choices:

- `target: ES2017`, `module: esnext`, `moduleResolution: bundler`
- `strict: true`, `noEmit: true` (Next handles emit)
- Path alias: `@/*` → `./src/*`
- `incremental: true` — generates `tsconfig.tsbuildinfo`

`tsconfig.tsbuildinfo` is gitignored — see [`.gitignore`](../.gitignore) line 8.

## Supabase Setup

Canonical schema: [`schema.sql`](../schema.sql). Run this on a fresh project
to bring everything up at once.

- Two tables: `plans` and `trades`. Both have `user_id` (FK to `auth.users`),
  `session_date`, and `created_at`.
- `plans.tldr` is a `jsonb` column written by `/api/tldr` and read by the
  TL;DR tab.
- `trades.idempotency_key` is a nullable text column, with a partial unique
  index on `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `es_price_cache` is a singleton table (`check (id = 1)`), seeded on create.
- RLS is enabled on all three tables; per-user `select / insert / update /
  delete` policies on `plans` and `trades`. `es_price_cache` has RLS on with
  no policies — only the service-role client touches it.

**Service key vs anon key.** `createAdminSupabase()` uses
`SUPABASE_SERVICE_KEY` and bypasses RLS — used by `/api/ingest` (upsert into
plans), `/api/es-price` (read/write the singleton cache), `/api/health`, and
`/api/tldr`. Everything user-facing uses `createServerSupabase()` (anon key
via SSR cookies) so RLS enforces ownership.

<!-- VERIFY: Supabase plan tier (free vs pro), region, pgcrypto/pg_cron extension status -->
<!-- VERIFY: pg_cron schedule for F8b ES price pre-warmer (referenced in migrate-es-price-cache.sql but not visible in repo) -->

## Render Deployment

The app is deployed to Render and served at `tradeladder.io`. Build command is
`next build`, start command is `next start`. The instrumentation hook in
`src/instrumentation.ts` requires the **Node runtime** — `NEXT_RUNTIME ===
"nodejs"` — and will not fire under the Edge runtime, so all routes that need
env-validated startup must run on Node (which is the Next.js default for App
Router route handlers in this repo).

<!-- VERIFY: exact Render service plan (Starter / Standard / Pro), region, autoscale or instance count -->
<!-- VERIFY: presence of OPENAI_API_KEY in the Render environment (must be added after F11 ships) -->

## Yahoo Finance Configuration

Used in [`src/app/api/es-price/route.ts`](../src/app/api/es-price/route.ts):

```ts
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const CACHE_TTL_MS = 60_000; // 60s — F6, eng-review locked
```

- `suppressNotices: ["yahooSurvey"]` silences the survey-prompt log line that
  yahoo-finance2 emits on first call.
- 60-second TTL on the cached quote, served from `es_price_cache` (id=1).
  Stale reads are returned with `stale: true` if Yahoo errors out, so the UI
  always has a recent frame to render.

## OpenAI Configuration

Used in [`src/lib/generate-tldr.ts:115-128`](../src/lib/generate-tldr.ts):

```ts
client.chat.completions.create({
  model: "gpt-5.5",
  max_completion_tokens: 16000,
  reasoning_effort: "high",
  response_format: { type: "json_object" },
  messages: [...],
});
```

- **Model:** `gpt-5.5`
- **Max completion tokens:** 16000
- **Reasoning effort:** `"high"`
- **Response format:** `json_object` (forces well-formed JSON output)

This is a high-cost configuration — a `high` reasoning budget at 16k output
tokens runs significantly more per call than a default chat completion. It is
acceptable here because TL;DR generation is invoked at most once per
`session_date` per user (the result is cached in `plans.tldr`). Re-generation
only happens if a plan is re-ingested.

## Idempotency & Cache Keys

| Key | Lives in | Lifetime | Purpose |
|-----|----------|----------|---------|
| `idempotency_key` (F10) | `trades.idempotency_key` (text) | One UUID per `NewTradeModal` open, generated client-side via `crypto.randomUUID()` (`src/components/TradeLog.tsx:254-257`). | Server dedupes on `(user_id, idempotency_key)` via the partial unique index, so a fast double-click or a retried POST cannot insert two rows. Server lookup at `src/app/api/trades/route.ts:47-57`. |
| `es_price_cache` row id | `es_price_cache.id` (always `1`) | Singleton, persisted across cold starts. | Single-row TTL cache for the ES quote. The `check (id = 1)` constraint guarantees there is only ever one row to update. |
| `parser_version` (Phase 5, future) | Constant in the parser module. | Not yet implemented. | When the LLM-driven parser lands, plans will be re-parseable and tagged with the parser version that produced them. Not present in the repo today. |

## Migrations on a Fresh Supabase

Two paths:

**Fresh project (preferred):** run [`schema.sql`](../schema.sql) once. It folds
in every migration to date plus the `tldr` jsonb column.

**Upgrading an existing project:** run the migrations in chronological order:

1. [`migrate-session-date.sql`](../migrate-session-date.sql) — adds `session_date` to `plans` and `trades`, backfills, indexes.
2. [`migrate-multi-tenant.sql`](../migrate-multi-tenant.sql) — adds `user_id`, enables RLS, creates ownership policies, indexes user_id.
3. [`migrate-trade-idempotency.sql`](../migrate-trade-idempotency.sql) — adds `trades.idempotency_key` and the partial unique index.
4. [`migrate-es-price-cache.sql`](../migrate-es-price-cache.sql) — creates the singleton `es_price_cache` table and seeds row 1.
5. **Manual step:** add the `tldr jsonb` column to `plans` (the comment at the top of `schema.sql` notes this was added directly via the Supabase dashboard and is folded into `schema.sql` for fresh deploys).

**Post-migration sanity check:** hit `/api/health` — it round-trips Supabase,
checks for the `es_price_cache` row, and returns 503 if anything is off
(`src/app/api/health/route.ts`).

## Ports & URLs

- **Local dev:** `http://localhost:3000` (Next.js default for `next dev` /
  `next start`).
- **Production:** `https://tradeladder.io`.
- **Supabase auth callback:** `/auth/callback` ([`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts)).
- **Health check:** `/api/health` (used by UptimeRobot per F8a).

<!-- VERIFY: DNS provider, CDN in front of Render (Cloudflare? bare Render?), TLS certificate issuer -->
<!-- VERIFY: Supabase auth Site URL and Redirect URL settings (must include https://tradeladder.io/auth/callback) -->

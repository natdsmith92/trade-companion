# External Integrations

**Analysis Date:** 2026-05-04

## APIs & External Services

**LLM (Trade plan summarization):**
- OpenAI Chat Completions — `lib/generate-tldr.ts:111-126`
  - Model: `"gpt-5.5"` (string literal at `lib/generate-tldr.ts:115`)
  - Params: `reasoning_effort: "high"`, `max_completion_tokens: 16000`, `response_format: { type: "json_object" }`
  - Auth: `OPENAI_API_KEY` env var (read at `lib/generate-tldr.ts:105`; missing-key path returns `null` and logs)
  - Output schema: `TldrData` from `src/lib/tldr-types.ts` — headline, 3 stat cards, 4 sections (WARNINGS / BEST SETUPS / BIG PICTURE / DECISION TREE), and an `fbSetups[]` array
  - Result is cached on `plans.tldr` (JSONB column referenced at `lib/generate-tldr.ts:154-157` and `app/api/ingest/route.ts:34`)
  - Flagged in `next.config.ts:3` as `serverExternalPackages`

**Market Data:**
- Yahoo Finance (unofficial) via `yahoo-finance2` ^3.14.0 — `src/app/api/es-price/route.ts`
  - Symbol: `"ES=F"` (`route.ts:34`)
  - In-memory module-level cache, 10s TTL (`CACHE_TTL = 10_000`, `route.ts:22`)
  - Returns last cached value with `stale: true` on fetch failure (`route.ts:46-48`)
  - No auth; no rate-limit handling beyond cache

## Data Storage

**Database:**
- Supabase Postgres
  - Connection: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS-respecting reads/writes), `SUPABASE_SERVICE_KEY` (admin/webhook bypass)
  - Client libs: `@supabase/ssr` for cookie-based auth, `@supabase/supabase-js` for service-role admin client
  - Tables (per `schema.sql` + `migrate-multi-tenant.sql`): `plans`, `trades`, both with RLS, both with `user_id uuid REFERENCES auth.users(id)`
  - Schema drift: `schema.sql:7-14` does **not** include `user_id` or a `tldr` column on `plans`, but the migrations and ingest code (`app/api/ingest/route.ts:34`) write both. The base schema file is stale relative to running production.

**File Storage:**
- None. No `storage.from(...)` calls; `public/` only contains static logos and favicons.

**Caching:**
- Process-local in-memory cache for ES price (`api/es-price/route.ts:14-22`). No Redis / external cache. Will not survive restarts and is per-instance (a problem if Render scales to multiple instances).

## Authentication & Identity

**Provider:** Supabase Auth
- Email/password sign-up and sign-in: `src/app/login/page.tsx:46-50`, `src/app/signup/page.tsx:43-50`
- Google OAuth: `src/app/login/page.tsx:31-39`, `src/app/signup/page.tsx:28-36` — redirect target `${window.location.origin}/auth/callback`
- Email confirmation handler: `src/app/auth/callback/route.ts` — exchanges `code` for session via `supabase.auth.exchangeCodeForSession(code)` (`route.ts:35`); honors `x-forwarded-host` / `x-forwarded-proto` for Render's internal proxy (`route.ts:11-15`)
- Session refresh + route gating in `src/middleware.ts`:
  - Public paths: `/login`, `/signup`, `/auth/callback`, `/api/ingest`, `/api/health` (`middleware.ts:31`)
  - All other routes redirect unauthenticated users to `/login`
  - Logged-in users hitting `/login` or `/signup` get redirected to `/`

**Authorization:**
- Postgres Row Level Security on `plans` and `trades` keyed off `auth.uid() = user_id` (`migrate-multi-tenant.sql:15-41`)
- The webhook bypass works because the admin client uses the service role key, but the ingest endpoint **requires** `user_id` in the payload (`app/api/ingest/route.ts:17-19`). No HMAC, signature, or shared-secret check on the webhook itself.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry / Datadog / Bugsnag SDK in `package.json`.

**Logs:**
- `console.log` / `console.error` in API routes (e.g. `app/api/ingest/route.ts:42, 46, 53`, `lib/generate-tldr.ts:107, 130, 159, 163, 168`). Render captures stdout/stderr, but there is no structured logging.

## CI/CD & Deployment

**Hosting:** Render (`CLAUDE.md`; corroborated by `auth/callback/route.ts:11` comment)

**CI:** None detected — no `.github/workflows/`, no `.circleci/`, no `.gitlab-ci.yml`.

**Domain:** `tradeladder.io` (per `CLAUDE.md`; no domain config in repo)

## Environment Configuration

**Documented in `.env.example`:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`

**Used in code but undocumented:**
- `OPENAI_API_KEY` (`lib/generate-tldr.ts:105`) — required for the TL;DR feature

**Secrets:**
- `.env` and `.env.local` are gitignored (`.gitignore:3-4`)
- Production secrets live in Render dashboard (no committed Render config)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/ingest` — Zapier (Gmail → webhook) is documented in `CLAUDE.md` as the producer
  - Payload: `{ date, subject, body, user_id }` (`app/api/ingest/route.ts:11`)
  - Behavior: parses email body via `parseLevels`, upserts on `(user_id, session_date)` to keep one plan per user per session, then fires `generateTldr` as a fire-and-forget Promise (`route.ts:49`)
  - **No auth on this route** — listed as a public path in middleware (`middleware.ts:31`). The only gate is "you must supply a `user_id`" — anyone who knows the URL and a valid `user_id` can write a plan into another user's account. CLAUDE.md mentions an "admin key"; no such check exists in code.
- `GET /auth/callback` — Supabase OAuth/email-confirmation redirect target

**Outgoing:**
- Yahoo Finance API (per fetch via `yahoo-finance2`)
- OpenAI Chat Completions (per ingested email)

---

*Integration audit: 2026-05-04*

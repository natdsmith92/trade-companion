# Changelog

All notable changes to TradeLadder are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-05-05

### Added

- **Per-tab error boundaries.** A render error in one dashboard tab no longer blanks the whole page. Each tab and the level ladder are wrapped in `<ErrorBoundary>`, plus Next.js `error.tsx` for route-level failures and `global-error.tsx` for the catastrophic case. `src/components/ErrorBoundary.tsx`.
- **Trade double-submit protection.** Fast double-clicks and network retries can no longer create duplicate trades. Client generates a UUID per modal open; server dedupes on `(user_id, idempotency_key)` via a partial unique index. `migrate-trade-idempotency.sql`.
- **Persistent ES price cache.** Replaced the module-level in-memory cache with a singleton row in Supabase (`es_price_cache`). Survives Render cold starts and stays consistent across instances. Yahoo failure now falls back to the cached row marked `stale: true`. `migrate-es-price-cache.sql`.
- **Boot-time env validation.** Missing required env vars now crash the server at startup instead of failing per-request inside route handlers. `src/instrumentation.ts` calls `assertEnv()` from `src/lib/env.ts` which validates `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, and `OPENAI_API_KEY`.
- **Useful `/api/health` endpoint.** Returns `{ ok, checks: { env, supabase, esPriceCache } }` with HTTP 200/503 based on hard checks. Designed for UptimeRobot or any external monitor; the es_price_cache check is a soft signal that doesn't trigger alerts.
- **Project documentation.** New `README.md`, `docs/GETTING-STARTED.md`, `docs/CONFIGURATION.md`, `docs/TESTING.md`. Existing `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT.md` regenerated against the live codebase.

### Changed

- **Refactored dashboard.** `src/app/page.tsx` reduced from 410 to ~190 lines. State and data fetching extracted into co-located hooks: `useAuth`, `useSessions`, `useParsedPlan`, `useTrades`, `useManualPrice`. P&L math moved to a pure function in `src/lib/pnl.ts`. Header extracted to `src/components/Header.tsx`. Components no longer drown in prop drilling, and future features can land cleanly into the affected unit.
- **Schema reconciled.** `schema.sql` now reflects the live database with `user_id`, RLS policies, the `tldr` JSONB column on `plans`, and the new `idempotency_key` and `es_price_cache` table. Greenfield deploys get the right shape from a single file.
- **Documentation reconciled to shipped reality.** `CLAUDE.md`, `docs/PRODUCT.md`, and `.env.example` updated. The Zapier ingest plan was rejected and replaced with a Resend inbound-email pipeline (Phase 4); Phase 5's parser uses OpenAI `gpt-5.5` with structured outputs, not Anthropic.
- **`tsconfig.tsbuildinfo` is now gitignored.** Stopped accidentally tracking the TypeScript incremental build cache.

### Fixed

- **Date navigator now works.** Clicking ◄ "Older session" or ► "Newer session" actually navigates between sessions. The original code did `idx - direction` against newest-first session order, which inverted the semantics — the old/new arrows quietly bounced off `idx 0`. Direction parameter renamed from `-1 | 1` to `"older" | "newer"` so it cannot get inverted again.
- **Paste flow no longer clears the screen.** Pasting a Mancini email used to set parsed levels locally, then immediately fetch `/api/latest-plan` for the same date and overwrite with `null` because the POST hadn't completed yet. The user had to paste again. Fix: a `justPastedDateRef` guards the load effect, skipping exactly the one stale fetch after a paste. The TL;DR headline now polls for ~30 seconds after a paste so the AI-generated headline populates without a refresh.

### Security

- **`/api/ingest` now requires authentication.** Previously, the route was in the middleware public-path allowlist with no admin key check. Anyone who knew (or guessed) a valid `user_id` could write fake plans into another user's session history. The route now derives `user_id` from the session cookie via `createServerSupabase()` and ignores any `user_id` field in the request body. `/api/inbound-email` (Phase 4, planned) will get its own HMAC-signature auth.

### Documentation

- Reviews and planning artifacts captured in `.planning/codebase/` (codebase scan: STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE) and `~/.gstack/projects/natdsmith92-trade-companion/` (CEO plan, eng-review test plan, QA report).

### For contributors

- New canonical schema at `schema.sql`. For existing Supabase projects, run `migrate-trade-idempotency.sql` and `migrate-es-price-cache.sql` before deploying this version (will 500 otherwise).
- `OPENAI_API_KEY` is now strictly required at boot. Previously the TL;DR pipeline failed silently per-request; now the server refuses to start without it.
- See `docs/DEVELOPMENT.md` for the new hook conventions and error boundary placement.

[1.1.0]: https://github.com/natdsmith92/trade-companion/releases/tag/v1.1.0

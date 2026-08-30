<!-- generated-by: gsd-doc-writer -->
# Testing

This document describes how TradeLadder is verified today and the planned automated test stack that will land as part of the pitch-readiness sprint.

## Current state — no automated tests

TradeLadder ships **zero** automated tests today. There is no test runner, no CI workflow, no coverage gate, and no LLM eval harness. The full devDependency list in `package.json` is `@tailwindcss/postcss`, `tailwindcss`, `typescript`, and the `@types/*` packages — no Vitest, Jest, Playwright, or Testing Library entries exist. The `package.json` `scripts` block contains only `dev`, `build`, and `start`. There is no `npm test`. There is no `.github/workflows/` directory.

The only verification today is:

1. The author runs the app locally and exercises happy paths by hand.
2. The end user (the author's father) reports problems out-of-band when something breaks during a live trading session.

This is acceptable for a single-user prototype. It is **not** acceptable for the SaaS launch, which is why F3 (test infrastructure) is on the pitch-readiness sprint and F11 (CI) follows it.

## Planned test stack (F3)

When F3 lands, the stack will be:

| Layer | Tool | Purpose |
|---|---|---|
| Unit + component | Vitest + React Testing Library | Pure functions (`src/lib/pnl.ts`, `src/lib/parser.ts`), component rendering, hook behavior |
| End-to-end | Playwright (mobile viewport profile) | Login -> paste email -> log trade -> see P&L flow on iPhone-class screen sizes |
| LLM eval | Custom harness in `tests/parser-eval/` | Parser quality on a corpus of golden Mancini emails with human-labeled ground truth |

Mobile-viewport E2E is non-negotiable: the user trades from a phone next to a desktop charting setup, so the UI must be verified at phone widths, not just desktop.

## What F3 will cover

F3 is the umbrella feature for "real test infrastructure." It must produce coverage for:

- **Parser regression suite** — every shipped Mancini email schema variant must stay parseable. Run on every change to the parser prompt or extraction code.
- **P&L math** — `computePnL` in `src/lib/pnl.ts` covers realized + unrealized split, the 75/25 runner case, fully-open trades, long vs short sign, and zero/negative `currentPrice` early return. All branches must be tested.
- **RLS boundaries** — `/api/trades` and (when E5 ships) `/api/level-corrections` must be verified to refuse cross-user reads and writes. A test must authenticate as user A and assert it cannot read or mutate user B's rows.
- **Inbound webhook signature validation** — when Phase 4 ships the signed Zapier webhook, signature mismatch and replay attempts must be covered.
- **`/api/es-price` staleness and cache** — verify the route returns the cached price when fresh and surfaces a stale flag past the threshold.
- **`/api/health` and `/api/health-deep`** — assert the response shape contract that UptimeRobot depends on. `/api/health-deep` is planned and does not exist yet.
- **`/admin/pitch` admin gate** — non-admin users must get a 404/403, not the page contents.
- **F7 error boundaries** — render-time errors in tab content must surface the boundary fallback rather than blank-screening the dashboard.
- **F10 idempotency** — duplicate webhook deliveries for the same email must collapse to a single `plans` row.
- **LevelLadder breathing animation states** — when E2 ships, the price-near-level pulse must be tested at the state level (not pixel-diffed), e.g. asserting class transitions when price crosses the threshold.

## LLM eval discipline

The parser is the single most fragile part of the system. Its quality is measured against a **human-labeled ground-truth set**, never against the model's own self-reported confidence.

The eval set will contain 10-15 real Mancini emails spanning the schema drift seen across the corpus (different headings, missing sections, malformed price ranges, multi-day plans). For each email, a human writer fills in the expected:

- numeric levels (support, resistance, magnets, ranges)
- bull and bear path triggers
- tag/setup classifications

The eval reports two scores:

- **Numeric extraction accuracy** — exact match on extracted levels, with a separate "within tolerance" score for ranges.
- **Tag accuracy** — categorical match on setup type and path direction.

The harness runs on every parser-prompt change. A regression below the previous baseline blocks the change.

## Manual smoke testing

Until F3 lands, the pre-deploy checklist is manual. Run all of these against the staging URL before promoting:

1. `GET /api/health` returns `200` with `ok: true` and all sub-checks green (or `esPriceCache` only soft-failing — see below).
2. Sign up a fresh test account, confirm the email link, and land on the dashboard.
3. Sign out, sign back in, and confirm the session persists across a refresh.
4. Open the paste modal and paste a real Mancini email — confirm the level ladder and game plan populate.
5. Log a trade with all four fields (entry, 75% exit, runner exit, contracts) and confirm P&L renders correctly.
6. Use the date navigator to step backward and forward across at least three saved sessions.
7. Resize the browser to a phone-width viewport and re-run steps 4-6.

The most recent QA pass is in `.gstack/qa-reports/qa-report-tradeladder-io-2026-05-05.md`. New QA reports should follow the same naming pattern (`qa-report-{host}-{YYYY-MM-DD}.md`) and live alongside the existing one.

## Production verification

`/api/health` (`src/app/api/health/route.ts`) is the canonical production health endpoint. UptimeRobot (F8a) hits it every five minutes and pages on a non-200 response.

The response shape is stable:

```json
{
  "ok": true,
  "checks": {
    "env":           { "ok": true, "detail": "all required keys present" },
    "supabase":      { "ok": true, "ms": 42 },
    "esPriceCache":  { "ok": true, "ms": 90000, "detail": "1m old" }
  }
}
```

What each check means:

- **`env`** — every required environment variable is present (presence only, no values logged). Missing keys flip `overallOk` to false and the route returns `503`. **Hard check.**
- **`supabase`** — a `SELECT id FROM plans LIMIT 1` round-trip succeeded. Failure flips `overallOk` to false and returns `503`. **Hard check.**
- **`esPriceCache`** — the `es_price_cache` row was updated within the last 5 minutes. **Soft check** — failure does **not** flip `overallOk` and the route still returns `200`. A persistent soft failure means F8b's pre-warmer is broken or Yahoo Finance stalled, but it does not page on-call.

`/api/health-deep` is planned but not implemented. When it ships, it will exercise heavier checks (write-then-rollback against `trades`, OpenAI ping) that are too expensive for a 5-minute monitor cadence.

## Eval data location

When F3 ships, golden Mancini emails will live at:

```
tests/parser-eval/
  fixtures/         # raw email bodies (.txt or .eml), one per case
  expected/         # human-labeled JSON ground truth, paired by filename
  run.ts            # eval runner
```

This directory **does not exist today**. Do not create it ahead of F3 — the schema is not finalized.

## Running tests (when they land)

These commands are **planned** and do not work today:

```bash
# Planned (F3): unit + component tests, single run
npm test

# Planned (F3): watch mode during development
npm test -- --watch

# Planned (F3): LLM parser eval against the golden corpus
npm run eval
```

If you run any of the above today, npm will exit with `Missing script`. That is expected.

## CI pipeline (F11)

**When F11 lands**, a GitHub Actions workflow will run on every pull request and on every push to `main`:

1. Install dependencies (`npm ci`).
2. Type-check (`tsc --noEmit`).
3. Lint (when ESLint config lands).
4. Vitest unit + component suite.
5. RLS boundary tests against an ephemeral Supabase project.
6. LLM parser eval against the golden corpus.

The eval step is **required** to pass on any PR that touches the parser prompt or extraction code. A red eval blocks merge.

There is no CI today. PRs are merged based on local checks only.

## Coverage targets

The CEO plan calls for boil-the-lake coverage at SaaS launch: **100% of new code paths must ship with tests** once F3 is in place. There is no allowance for deferred test debt at SaaS launch — every code path that handles a customer's money, identity, or trade plan must be exercised.

This is a forward-looking target. Existing pre-F3 code will be backfilled as F3 work touches each module.

## Test data conventions (planned)

When fixtures and ground-truth data start landing in `tests/parser-eval/`:

- **Never use real customer email content** in committed fixtures. The Mancini emails saved as ground truth are the author's own subscriber copies; they must be redacted of any subscriber-identifying text (recipient name, account ID, unsubscribe token, forwarding metadata) before being committed.
- **Redact subscriber identity** from saved emails. Replace the recipient block with a synthetic placeholder.
- **Use synthetic dates and levels where possible.** When the test does not depend on a specific historical session, prefer made-up but realistic ES levels over real Mancini calls. This keeps fixtures stable against any future request to remove specific dated content.

These conventions apply the moment the first fixture is committed.

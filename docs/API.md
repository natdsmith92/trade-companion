<!-- generated-by: gsd-doc-writer -->
# API Reference

HTTP API surface for TradeLadder. All routes live under `src/app/api/` and run as Next.js App Router route handlers.

## Overview

- **Base URL (production):** `https://tradeladder.io` <!-- VERIFY: production base URL — derived from CLAUDE.md, no deployed URL config in repo -->
- **Base URL (local dev):** `http://localhost:3000`
- **Auth model:** Session-cookie auth via Supabase SSR (`@supabase/ssr`). The `src/middleware.ts` file gates every non-public path and refreshes the session on each request. Service-role access exists only inside the server (admin Supabase client) and is never exposed to clients.
- **Content type:** All routes accept and return `application/json`.
- **Error envelope:** Failures return `{ "error": "<message>" }` with a non-2xx HTTP status.

### Public vs gated paths

Defined in `src/middleware.ts:34`:

```
publicPaths = ["/login", "/signup", "/auth/callback", "/api/health"]
```

Every other path — including all `/api/*` routes not listed above — requires a logged-in user. Unauthenticated requests are redirected to `/login` (`src/middleware.ts:38-42`).

## Authentication

TradeLadder uses Supabase Auth email/password. After a successful login (`/login` page), Supabase sets two HTTP-only cookies named `sb-access-token` and `sb-refresh-token` (exact names are managed by `@supabase/ssr` and may include a project-ref prefix, e.g. `sb-<project-ref>-auth-token`).

Once the session cookies are present, any request to a gated route is authenticated automatically — your server reads the cookies through `createServerSupabase()` (`src/lib/supabase-server.ts:6`) and calls `supabase.auth.getUser()` to identify the user. RLS policies on the `plans` and `trades` tables ensure each user only sees their own rows.

For scripted access from another service, perform a session login against Supabase first (e.g. via the Supabase JS SDK or a direct call to the Supabase Auth REST endpoint), then forward the resulting cookies to TradeLadder. The cookie header pattern looks like:

```
Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>
```

Middleware refreshes the session on each request, so long-lived scripts only need to perform the initial login.

## Routes

### `GET /api/health`

Public health check used by UptimeRobot (planned: F8a). Returns the status of every back-end dependency the app relies on.

- **File:** `src/app/api/health/route.ts:14`
- **Auth:** Public (listed in `publicPaths`).
- **Side effects:** One read against `plans` and one read against `es_price_cache`.

**Response shape:**

```json
{
  "ok": true,
  "checks": {
    "env": { "ok": true, "detail": "all required keys present" },
    "supabase": { "ok": true, "ms": 47 },
    "esPriceCache": { "ok": true, "ms": 38000, "detail": "1m old" }
  }
}
```

**Hard vs soft checks:**

| Check          | Type | Toggles `ok`?                                      |
| -------------- | ---- | -------------------------------------------------- |
| `env`          | hard | Yes — missing required env keys flips `ok` to false |
| `supabase`     | hard | Yes — Supabase round-trip failure flips `ok`       |
| `esPriceCache` | soft | **No** — stale or missing cache row never flips `ok` |

The ES price cache check is informational. It reports the row age (5-minute freshness threshold at `src/app/api/health/route.ts:53`) but does not contribute to `overallOk`. This matches the philosophy that a stale price cache degrades the UI gracefully but should not page operators.

**HTTP status:**
- `200` if `overallOk` is true
- `503` if any hard check (`env` or `supabase`) failed

**curl:**

```bash
curl -i https://tradeladder.io/api/health
```

---

### `GET /api/es-price`

Returns the cached ES futures front-month quote, refreshing from Yahoo Finance on cache miss.

- **File:** `src/app/api/es-price/route.ts:36`
- **Auth:** Middleware-gated (session cookie required).
- **Side effects:** May upsert the `es_price_cache` singleton row (id=1) and call Yahoo Finance (`yahoo-finance2` SDK) for `ES=F`.
- **Cache TTL:** 60 seconds (`CACHE_TTL_MS` at `src/app/api/es-price/route.ts:6`).

**Response shape (fresh):**

```json
{
  "price": 6712.25,
  "change": 18.5,
  "changePercent": 0.28,
  "marketState": "REGULAR",
  "timestamp": 1714857600000
}
```

**Response shape (stale fallback):**

```json
{
  "price": 6712.25,
  "change": 18.5,
  "changePercent": 0.28,
  "marketState": "CLOSED",
  "timestamp": 1714854000000,
  "stale": true
}
```

**Behaviour:**
1. Read singleton row from `es_price_cache` (id=1).
2. If cached price > 0 and age < 60s → return immediately, no `stale` flag.
3. Otherwise, fetch `ES=F` from Yahoo Finance, fire-and-forget the upsert, and return the fresh quote.
4. If Yahoo fails and a cached row exists, return the cached row with `"stale": true` and HTTP 200.
5. If Yahoo fails and no cached row exists, return zeroed payload with `"stale": true` and **HTTP 502**.

**HTTP status:**
- `200` on success (fresh, fresh-from-cache, or stale-fallback)
- `502` only when both Yahoo and the cache are unavailable (`src/app/api/es-price/route.ts:85-95`)

**curl:**

```bash
curl -i https://tradeladder.io/api/es-price \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

---

### `POST /api/ingest`

Manual-paste endpoint for the dashboard's "Paste email" modal. Stores a Mancini email, parses it into levels, and triggers asynchronous TL;DR generation.

- **File:** `src/app/api/ingest/route.ts:13`
- **Auth:** Session-authenticated. **F2:** the `user_id` is derived from `auth.getUser()` and never read from the request body, even if the body contains a `user_id` field (`src/app/api/ingest/route.ts:23-29`).
- **Side effects:**
  - Calls `parseLevels()` (`src/lib/parser.ts:10`) to extract supports, resistances, and the session date.
  - Upserts the `plans` table on conflict key `(user_id, session_date)` using the admin Supabase client (`src/app/api/ingest/route.ts:38-52`).
  - Fire-and-forget call to `generateTldr()` (`src/lib/generate-tldr.ts:101`), which calls OpenAI (`gpt-5.5`, `reasoning_effort: "high"`) and writes the result back to `plans.tldr`.

**Request:**

```json
{
  "date": "2026-05-03T20:00:00Z",
  "subject": "May 4 Plan: Buy The Dip Or Stay Cautious?",
  "body": "Full email text including Supports are: ... Resistances are: ..."
}
```

| Field     | Type   | Required | Notes                                                   |
| --------- | ------ | -------- | ------------------------------------------------------- |
| `body`    | string | Yes      | Raw email body. Used by `parseLevels()`.                |
| `subject` | string | No       | Falls back to `"Trade Plan"` when omitted.              |
| `date`    | string | No       | ISO timestamp; defaults to `new Date().toISOString()`.  |
| `user_id` | —      | —        | Ignored. Always taken from the session.                 |

**Response (200):**

```json
{
  "status": "ok",
  "id": "8f3b2a44-...-uuid",
  "session_date": "2026-05-04"
}
```

**Failure modes:**

| Status | Body                                  | Cause                                         |
| ------ | ------------------------------------- | --------------------------------------------- |
| 400    | `{ "error": "Missing email body" }`   | Request body did not contain a `body` field.  |
| 401    | `{ "error": "Not authenticated" }`    | No session cookie or expired token.           |
| 500    | `{ "error": "Failed to store plan" }` | Supabase upsert error.                        |
| 500    | `{ "error": "Server error" }`         | Caught exception (JSON parse, parser crash).  |

> The Resend webhook path (Phase 4) is planned at `/api/inbound-email` and **does not exist yet**. The note in `src/app/api/ingest/route.ts:11-12` and `src/middleware.ts:32-33` describes that future route. Once shipped it will use signature-based auth instead of session cookies.

**curl:**

```bash
curl -i -X POST https://tradeladder.io/api/ingest \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>" \
  -d '{
    "date": "2026-05-03T20:00:00Z",
    "subject": "May 4 Plan",
    "body": "Supports are: 6685 (major), 6663...\nResistances are: 6716 (major)..."
  }'
```

---

### `GET /api/latest-plan`

Fetches a single plan row, scoped to the caller via RLS.

- **File:** `src/app/api/latest-plan/route.ts:4`
- **Auth:** Middleware-gated. RLS scopes results to `auth.uid()`.

**Query params:**

| Param  | Type   | Required | Notes                                                      |
| ------ | ------ | -------- | ---------------------------------------------------------- |
| `date` | string | No       | `YYYY-MM-DD` session date. Without it, returns the most recent plan. |

**Response (200):** A single `plans` row.

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "session_date": "2026-05-04",
  "email_date": "2026-05-03T20:00:00Z",
  "subject": "May 4 Plan",
  "body": "Full email text...",
  "tldr": { "headline": "...", "stats": [...], "sections": [...], "fbSetups": [...] },
  "created_at": "2026-05-03T20:15:00Z"
}
```

The `tldr` field may be `null` until the asynchronous generation completes.

**Failure modes:**

| Status | Body                          | Cause                                        |
| ------ | ----------------------------- | -------------------------------------------- |
| 404    | `{ "error": "No plan found" }` | No plan exists for this user / date filter. |
| 500    | `{ "error": "Server error" }`  | Unhandled exception.                         |

**curl:**

```bash
curl -i "https://tradeladder.io/api/latest-plan?date=2026-05-04" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

---

### `GET /api/sessions`

Lists session dates that have plans for the authenticated user. Powers the date navigator dropdown.

- **File:** `src/app/api/sessions/route.ts:4`
- **Auth:** Middleware-gated. RLS scopes results to the caller.
- **Limit:** Up to 90 most recent sessions, ordered by `session_date` descending (`src/app/api/sessions/route.ts:10-11`).

**Response (200):**

```json
[
  { "session_date": "2026-05-04", "subject": "May 4 Plan" },
  { "session_date": "2026-05-03", "subject": "May 3 Plan" },
  { "session_date": "2026-05-02", "subject": "May 2 Plan" }
]
```

**Failure modes:**

| Status | Body                                       |
| ------ | ------------------------------------------ |
| 500    | `{ "error": "Failed to fetch sessions" }`  |
| 500    | `{ "error": "Server error" }`              |

**curl:**

```bash
curl -i https://tradeladder.io/api/sessions \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

---

### `GET /api/tldr`

Returns the AI-generated TL;DR JSON for a session. Falls back to synchronous generation if not yet cached.

- **File:** `src/app/api/tldr/route.ts:5`
- **Auth:** Middleware-gated. RLS scopes the underlying `plans` lookup.
- **Side effects:** May call OpenAI synchronously via `generateTldr()` if `plans.tldr` is null (`src/app/api/tldr/route.ts:31-35`).

**Query params:**

| Param  | Type   | Required | Notes                            |
| ------ | ------ | -------- | -------------------------------- |
| `date` | string | **Yes**  | `YYYY-MM-DD`. 400 if omitted.    |

**Response (200):** The cached `TldrData` object (see `src/lib/tldr-types.ts:29`).

```json
{
  "headline": "Bullish above 6685, targeting 6716-6738 if dips hold 6663.",
  "stats": [
    { "label": "Rally", "value": "+52pts", "color": "bull", "subtitle": "off Tuesday low" }
  ],
  "sections": [
    {
      "title": "WARNINGS",
      "icon": "⚠",
      "color": "bear",
      "insights": [
        { "tag": "Caution", "tagType": "caution", "text": "Don't chase first bounces..." }
      ]
    }
  ],
  "fbSetups": [
    {
      "level": 6685,
      "quality": "A+",
      "action": "Buy if price flushes below <span class=\"num\">6685</span> and recovers within 15m",
      "context": "Tuesday low — FB targets 6716 → 6738",
      "invalidation": "Closes below 6663 on 15m candle"
    }
  ]
}
```

**Failure modes:**

| Status | Body                                          | Cause                                              |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| 400    | `{ "error": "Missing date param" }`           | No `?date=` in the query string.                   |
| 404    | `{ "error": "No plan found for this date" }`  | No plan row matches `session_date=date` for user.  |
| 503    | `{ "error": "TL;DR generation failed" }`      | Synchronous fallback failed (OpenAI error, missing `OPENAI_API_KEY`, malformed response). |
| 500    | `{ "error": "Server error" }`                 | Unhandled exception.                               |

**curl:**

```bash
curl -i "https://tradeladder.io/api/tldr?date=2026-05-04" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

---

### `GET /api/trades`

Lists the caller's trades, optionally scoped to a session date or trailing window.

- **File:** `src/app/api/trades/route.ts:4`
- **Auth:** Middleware-gated. RLS scopes the result set.

**Query params:**

| Param  | Type    | Required | Notes                                                                             |
| ------ | ------- | -------- | --------------------------------------------------------------------------------- |
| `date` | string  | No       | `YYYY-MM-DD`. If present, filters by `session_date = date`.                       |
| `days` | integer | No       | Default `30`. Used only when `date` is absent — returns trades from last N days. |

**Response (200):** Array of `Trade` rows (see `src/lib/types.ts:16`).

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "session_date": "2026-05-04",
    "symbol": "ES",
    "direction": "long",
    "contracts": 2,
    "entry_price": 6685,
    "exit_75_price": 6700,
    "exit_runner_price": 6716,
    "setup_type": "Failed Breakdown",
    "point_value": 50,
    "notes": null,
    "pnl": 1900,
    "idempotency_key": "ui-2026-05-04-09:31:42",
    "created_at": "2026-05-04T13:31:42Z"
  }
]
```

**Failure modes:**

| Status | Body                                     |
| ------ | ---------------------------------------- |
| 500    | `{ "error": "Failed to fetch trades" }`  |
| 500    | `{ "error": "Server error" }`            |

**curl:**

```bash
curl -i "https://tradeladder.io/api/trades?date=2026-05-04" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

---

### `POST /api/trades`

Inserts a new trade for the authenticated user.

- **File:** `src/app/api/trades/route.ts:33`
- **Auth:** Session-authenticated. `user_id` is taken from `auth.getUser()` (`src/app/api/trades/route.ts:39-42`).
- **Side effects:** One insert into `trades`. No external calls.

**F10 idempotency:** If the request body includes an `idempotency_key` and a row with `(user_id, idempotency_key)` already exists, the existing row is returned **without inserting a duplicate** (`src/app/api/trades/route.ts:47-57`). This protects against double-tap and network-retry duplicates.

**Request:**

```json
{
  "session_date": "2026-05-04",
  "symbol": "ES",
  "direction": "long",
  "contracts": 2,
  "entry_price": 6685,
  "exit_75_price": null,
  "exit_runner_price": null,
  "setup_type": "Failed Breakdown",
  "point_value": 50,
  "notes": null,
  "idempotency_key": "ui-2026-05-04-09:31:42"
}
```

| Field             | Type    | Required | Notes                                                  |
| ----------------- | ------- | -------- | ------------------------------------------------------ |
| `session_date`    | string  | Yes      | `YYYY-MM-DD`.                                          |
| `symbol`          | string  | Yes      | `ES`, `MES`, `MNQ`, `NQ`.                              |
| `direction`       | string  | Yes      | `long` or `short`.                                     |
| `contracts`       | integer | Yes      | Position size.                                         |
| `entry_price`     | number  | Yes      | Fill price.                                            |
| `point_value`     | number  | Yes      | 50 (ES), 5 (MES), 2 (MNQ), 20 (NQ).                    |
| `setup_type`      | string  | No       | `Failed Breakdown` / `Flag` / `Trendline` / `Other`.   |
| `exit_75_price`   | number  | No       | First-target exit (75% of contracts).                  |
| `exit_runner_price` | number | No       | Runner exit (25% of contracts).                        |
| `pnl`             | number  | No       | Pre-computed P&L; usually patched in later.            |
| `notes`           | string  | No       | Free text.                                             |
| `idempotency_key` | string  | No       | Optional; enables F10 duplicate-suppression.           |
| `user_id`         | —       | —        | Ignored; always overwritten with the session user.     |

**Response (200):** The created (or pre-existing) `trades` row.

**Failure modes:**

| Status | Body                                     | Cause                                  |
| ------ | ---------------------------------------- | -------------------------------------- |
| 401    | `{ "error": "Not authenticated" }`       | Missing or expired session.            |
| 500    | `{ "error": "Failed to store trade" }`   | Supabase insert error.                 |
| 500    | `{ "error": "Server error" }`            | Unhandled exception.                   |

**curl:**

```bash
curl -i -X POST https://tradeladder.io/api/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>" \
  -d '{
    "session_date": "2026-05-04",
    "symbol": "ES",
    "direction": "long",
    "contracts": 2,
    "entry_price": 6685,
    "point_value": 50,
    "setup_type": "Failed Breakdown",
    "idempotency_key": "ui-2026-05-04-09:31:42"
  }'
```

---

### `PATCH /api/trades/[id]`

Updates a trade (typically to add exit prices and `pnl`).

- **File:** `src/app/api/trades/[id]/route.ts:4`
- **Auth:** Session-authenticated. RLS ensures the caller can only update their own trades — the route does not perform an explicit `user_id` check; it relies on the row being invisible to the user otherwise (`src/app/api/trades/[id]/route.ts:10-16`).

**Path params:**

| Param | Type      | Notes                  |
| ----- | --------- | ---------------------- |
| `id`  | uuid      | The `trades.id` value. |

**Request:** Partial `Trade` object — any subset of mutable columns.

```json
{
  "exit_75_price": 6700,
  "exit_runner_price": 6716,
  "pnl": 1900
}
```

**Response (200):** The updated row.

**Failure modes:**

| Status | Body                                       | Cause                                                                |
| ------ | ------------------------------------------ | -------------------------------------------------------------------- |
| 500    | `{ "error": "Failed to update trade" }`    | RLS denied the update, the id does not exist, or Supabase errored.  |
| 500    | `{ "error": "Server error" }`              | Unhandled exception.                                                 |

> Because RLS denial and "not found" both surface as Supabase errors, the route currently returns 500 in both cases rather than distinguishing 403 / 404.

**curl:**

```bash
curl -i -X PATCH https://tradeladder.io/api/trades/8f3b2a44-...-uuid \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>" \
  -d '{ "exit_75_price": 6700, "exit_runner_price": 6716, "pnl": 1900 }'
```

---

### `DELETE /api/trades/[id]`

Deletes a trade.

- **File:** `src/app/api/trades/[id]/route.ts:29`
- **Auth:** Session-authenticated. RLS-enforced (same pattern as PATCH).

**Path params:** Same as PATCH.

**Response (200):**

```json
{ "status": "deleted" }
```

**Failure modes:**

| Status | Body                                       | Cause                                |
| ------ | ------------------------------------------ | ------------------------------------ |
| 500    | `{ "error": "Failed to delete trade" }`    | RLS denied / id missing / DB error.  |
| 500    | `{ "error": "Server error" }`              | Unhandled exception.                 |

**curl:**

```bash
curl -i -X DELETE https://tradeladder.io/api/trades/8f3b2a44-...-uuid \
  -H "Cookie: sb-access-token=<jwt>; sb-refresh-token=<refresh>"
```

## Error response shape

Every error response uses the same envelope:

```json
{ "error": "<short human-readable message>" }
```

| HTTP code | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| 400       | Bad request — missing required field or malformed input.                 |
| 401       | Not authenticated — session cookie missing or expired.                   |
| 404       | Not found — query matched zero rows (only emitted by `latest-plan`/`tldr`). |
| 500       | Server error — unhandled exception or Supabase failure.                  |
| 502       | Upstream failure — only `/api/es-price` when Yahoo and cache both fail.  |
| 503       | Service unavailable — `/api/health` (hard check failed) or `/api/tldr` (sync fallback failed). |

Errors are also logged via `console.error()` server-side; clients should treat the response body's `error` string as a hint, not a stable identifier.

## Rate limiting

**No rate limiting is implemented.** There is no `express-rate-limit`, `@upstash/ratelimit`, or equivalent middleware in the codebase. Each route is bounded only by Supabase's own connection limits and (for `/api/es-price` and `/api/tldr`) Yahoo Finance and OpenAI quotas.

This is a known gap. A future workstream is expected to add per-user rate limits to the OpenAI-touching routes (`/api/ingest`, `/api/tldr`) before public launch.

## CORS

No CORS middleware is configured. Next.js App Router serves API routes with default same-origin policy — browsers will reject cross-origin requests unless they originate from the same domain as the deployment (`tradeladder.io` in production). Server-to-server callers (curl, scripts) are unaffected.

If multi-origin access is needed in the future (e.g. a separate marketing site calling `/api/health`), `Access-Control-Allow-Origin` headers will need to be added at the route or middleware layer.

## Planned routes (not yet implemented)

The routes below are documented in code comments and the project roadmap but **do not exist** in the current codebase. Calls to these paths will hit the catch-all 404 / login redirect.

| Path                       | Phase / ID | Purpose                                                              |
| -------------------------- | ---------- | -------------------------------------------------------------------- |
| `POST /api/inbound-email`  | Phase 4    | Resend inbound-email webhook. Will replace manual paste for the production user. Webhook-signature auth (no session cookies). Reference: `src/app/api/ingest/route.ts:11-12`, `src/middleware.ts:32-33`. |
| `POST /api/parse-plan`     | Phase 5    | LLM-driven structured parser to replace `parseLevels()` regex extractor for richer plan structure. |
| `POST /api/level-corrections` | E5      | User-submitted corrections to extracted levels (training data for parser improvements). |
| `GET /api/health-deep`     | F8         | Extended health probe with deeper checks (latency percentiles, OpenAI ping, etc.) for on-call use. |
| `GET /admin/pitch`         | E6         | Admin-gated investor/partner pitch page. Not strictly an API route, but admin-gated alongside the API surface. |

When these routes ship, this document will be regenerated to include them.

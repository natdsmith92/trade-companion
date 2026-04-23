# API Reference

Base URL: `https://tradeladder.io`

## Authentication

All endpoints except `/api/ingest` and `/api/health` require an authenticated user session via Supabase Auth cookies. Unauthenticated requests are redirected to `/login` by the middleware.

The `/api/ingest` webhook uses the Supabase service_role key (admin client) and requires an explicit `user_id` in the payload.

---

## POST /api/ingest

Webhook endpoint for Zapier. Stores a Mancini email and parses the session date.

**Auth:** Admin (service key, bypasses RLS)

**Request:**
```json
{
  "date": "2026-04-22T20:00:00Z",
  "subject": "Is Buy The Dip Back In SPX? April 23 Plan",
  "body": "Full email text including Supports are: ... Resistances are: ...",
  "user_id": "uuid-of-the-user"
}
```

**Response (200):**
```json
{
  "status": "ok",
  "id": "plan-uuid",
  "session_date": "2026-04-23"
}
```

**Errors:**
- 400: Missing `body` or `user_id`
- 500: Supabase insert failure

---

## GET /api/latest-plan

Fetch the most recent plan, optionally filtered by session date.

**Auth:** User session (RLS scoped)

**Query params:**
- `date` (optional): ISO date string, e.g. `2026-04-23`

**Examples:**
```
GET /api/latest-plan              → most recent plan for this user
GET /api/latest-plan?date=2026-04-23  → plan for April 23 session
```

**Response (200):**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "session_date": "2026-04-23",
  "email_date": "2026-04-22T20:00:00Z",
  "subject": "April 23 Plan",
  "body": "Full email text...",
  "created_at": "2026-04-22T20:15:00Z"
}
```

**Errors:**
- 404: No plan found

---

## GET /api/sessions

List all session dates that have plans for the authenticated user.

**Auth:** User session (RLS scoped)

**Response (200):**
```json
[
  { "session_date": "2026-04-23", "subject": "April 23 Plan" },
  { "session_date": "2026-04-22", "subject": "April 22 Plan" },
  { "session_date": "2026-04-21", "subject": "April 21 Plan" }
]
```

Returns up to 90 most recent sessions, newest first.

---

## GET /api/trades

Fetch trades, optionally filtered by session date.

**Auth:** User session (RLS scoped)

**Query params:**
- `date` (optional): ISO date string → trades for that session
- `days` (optional, default 30): if no date, returns trades from last N days

**Examples:**
```
GET /api/trades                   → last 30 days of trades
GET /api/trades?date=2026-04-23   → trades for April 23 session
GET /api/trades?days=7            → last 7 days of trades
```

**Response (200):**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "session_date": "2026-04-23",
    "symbol": "ES",
    "direction": "long",
    "contracts": 2,
    "entry_price": 6685,
    "exit_75_price": 6700,
    "exit_runner_price": null,
    "setup_type": "Failed Breakdown",
    "point_value": 50,
    "notes": null,
    "pnl": 1125,
    "created_at": "2026-04-23T14:30:00Z"
  }
]
```

---

## POST /api/trades

Log a new trade.

**Auth:** User session (RLS scoped — user_id auto-attached from session)

**Request:**
```json
{
  "session_date": "2026-04-23",
  "symbol": "ES",
  "direction": "long",
  "entry_price": 6685,
  "contracts": 2,
  "setup_type": "Failed Breakdown",
  "point_value": 50
}
```

**Response (200):** The created trade object (same shape as GET response items).

---

## PATCH /api/trades/:id

Update a trade (typically to add exit prices and P&L).

**Auth:** User session (RLS scoped)

**Request (partial update):**
```json
{
  "exit_75_price": 6700,
  "exit_runner_price": 6716,
  "pnl": 1906.25
}
```

**Response (200):** The updated trade object.

---

## DELETE /api/trades/:id

Delete a trade.

**Auth:** User session (RLS scoped)

**Response (200):**
```json
{ "status": "deleted" }
```

---

## GET /api/health

Health check endpoint (no auth required).

**Response (200):**
```json
{
  "status": "ok",
  "supabase": true
}
```

---

## P&L Calculation Logic

P&L is calculated client-side using the 75/25 rule, then sent to the API via PATCH:

```
direction_sign = (direction === "long") ? 1 : -1

pnl_75 = (exit_75_price - entry_price) × direction_sign × (contracts × 0.75) × point_value
pnl_runner = (exit_runner_price - entry_price) × direction_sign × (contracts × 0.25) × point_value
total_pnl = pnl_75 + pnl_runner
```

**Example:** Long 2 ES at 6685, 75% exit at 6700, runner at 6716
```
pnl_75 = (6700 - 6685) × 1 × 1.5 × 50 = $1,125
pnl_runner = (6716 - 6685) × 1 × 0.5 × 50 = $775
total = $1,900
```

## Zapier Webhook Configuration

In Zapier, create a Zap:
1. **Trigger:** Gmail → New Email Matching Search → `from:substack.com subject:"Plan"`
2. **Action:** Webhooks by Zapier → POST
   - URL: `https://tradeladder.io/api/ingest`
   - Payload type: JSON
   - Data:
     - `date` → Email Date
     - `subject` → Email Subject
     - `body` → Email Body Plain
     - `user_id` → hardcode the user's UUID from Supabase Auth

The `user_id` is required because Zapier has no user session. Find it in Supabase Dashboard → Authentication → Users → click the user → copy their UUID.

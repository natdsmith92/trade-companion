# Architecture Design

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S TRADING DESK                         │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ Optimus Flow │  │ ThinkorSwim  │  │      TradeLadder.io       │ │
│  │  (execution) │  │  (charting)  │  │  (planning + tracking)    │ │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────── DATA PIPELINE ────────────────────┐
│                                                        │
│  Mancini Email (4pm)                                   │
│       ↓                                                │
│  Gmail Inbox                                           │
│       ↓                                                │
│  Zapier (auto-detect new email)                        │
│       ↓                                                │
│  POST /api/ingest (webhook)                            │
│       ↓                                                │
│  Parser extracts: session_date, levels, scenarios      │
│       ↓                                                │
│  Supabase (plans table)                                │
│       ↓                                                │
│  User opens app → dashboard populated automatically    │
└────────────────────────────────────────────────────────┘
```

## Three Supabase Clients

The app uses three distinct Supabase client configurations for different security contexts:

### 1. Browser Client (`createBrowserSupabase`)
- Used in `"use client"` components
- Authenticates via cookies (user's session)
- Uses the publishable/anon key
- Subject to Row Level Security — can only access the logged-in user's data
- Used for: login, signup, sign out, client-side auth checks

### 2. Server Client (`createServerSupabase`)
- Used in API routes and server components
- Reads auth session from cookies
- Uses the publishable/anon key
- Subject to Row Level Security — scoped to the requesting user
- Used for: all authenticated API routes (plans, trades, sessions)

### 3. Admin Client (`createAdminSupabase`)
- Used only in the `/api/ingest` webhook
- Uses the service_role secret key
- Bypasses Row Level Security completely
- Requires explicit `user_id` in the request payload
- Used for: Zapier webhook ingestion (no user session available)

## Row Level Security (RLS)

Every row in `plans` and `trades` has a `user_id` column. RLS policies enforce:
- SELECT: `auth.uid() = user_id` — users can only read their own data
- INSERT: `auth.uid() = user_id` — users can only insert with their own user_id
- UPDATE: `auth.uid() = user_id` — users can only update their own records
- DELETE: `auth.uid() = user_id` — users can only delete their own records

The admin client (service key) bypasses these policies, which is why the webhook endpoint can insert plans for any user.

## Auth Flow

```
User visits tradeladder.io
       ↓
Middleware checks auth session
       ↓ (no session)
Redirect to /login
       ↓
User enters email + password
       ↓
Supabase Auth verifies credentials
       ↓
Session cookie set in browser
       ↓
Redirect to / (dashboard)
       ↓
Middleware refreshes session on every request
       ↓
API routes read user from session cookies
```

## Session Date Architecture

Each Mancini email applies to a specific trading day (the "session"). The `session_date` column is the primary organizing key:

- Mancini sends email at ~4pm on Day N for Day N+1
- The parser extracts the date from the email subject ("April 23 Plan" → 2026-04-23)
- Falls back to next trading day if no date found (skips weekends)
- Both `plans` and `trades` tables use `session_date` as a filter
- The date navigator in the header lets users browse historical sessions
- Switching sessions reloads the entire dashboard (levels, game plan, trades)

## Email Parsing Pipeline

The parser (`src/lib/parser.ts`) handles Mancini's consistent email format:

### Level Extraction
- Regex matches "Supports are:" and "Resistances are:" sections
- Each level is a 4-5 digit number, optionally followed by "(major)"
- Handles ranges: "6778-82" → 6778 and 6782, "6820-6822" → 6820 and 6822
- Returns arrays of `{ price, type, major }` objects

### Scenario Extraction
- Bull/bear targets: extracts 4-5 digit numbers from bull/bear case sections
- Triggers: matches "if X holds/fails/recovers" patterns
- Lean: extracts the directional bias statement

### P&L Calculation
- Implements Mancini's 75/25 trade management rule
- 75% of contracts exit at first target, 25% trail as runner
- Accounts for long/short direction and per-contract point value

## API Design

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/ingest` | POST | Admin key | Zapier webhook — stores Mancini email |
| `/api/latest-plan` | GET | User session | Fetch plan for a session date |
| `/api/sessions` | GET | User session | List all session dates for the user |
| `/api/trades` | GET | User session | Fetch trades for a session date |
| `/api/trades` | POST | User session | Log a new trade |
| `/api/trades/[id]` | PATCH | User session | Update trade (add exits, P&L) |
| `/api/trades/[id]` | DELETE | User session | Delete a trade |
| `/api/health` | GET | None | Health check for Render |

## Frontend Architecture

Single-page dashboard with three tab views:

### Screen 1: Level Ladder
- Vertical scrolling list of all support/resistance levels
- Sorted highest to lowest (resistance at top, support at bottom)
- Major levels highlighted in gold with larger font
- Current price shown as blue highlighted band
- Support labels on left, resistance labels on right

### Screen 2: Game Plan
- Two-column layout: bull path (green) and bear path (red)
- Each path shows sequential target levels
- Trigger cards below: plain-English if/then rules with highlighted price numbers
- Active zones highlight based on current price

### Screen 3: Trade Log
- New Trade form: symbol, direction, entry price, contracts, setup type
- Trade list with entry/exit prices, P&L, setup tags
- Inline edit for 75% exit and runner exit
- Auto-calculates P&L on exit entry
- Open trades shown with blue border

### Header (persistent)
- TradeLadder branding
- Date navigator with ◄ ► arrows
- Directional lean display
- Current ES price input (manual)
- Session P&L (auto-calculated from trades)
- User email + sign out

## Deployment

- **Hosting:** Render (Web Service, $25/mo plan)
- **Database:** Supabase (free tier — 500MB, unlimited API calls)
- **Domain:** tradeladder.io (Hover, DNS pointed to Render via A record + CNAME)
- **CI/CD:** Push to GitHub `main` → Render auto-deploys
- **Build:** `npm install` → `npm run build` → `npm start`

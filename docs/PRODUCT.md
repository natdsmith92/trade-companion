# Product Requirements & Roadmap

## The Three Screens

### Screen 1: Level Ladder (Today's Levels)

**Replaces:** Reading the email and drawing lines on TOS charts.

**Current state:** Built. Displays parsed levels in a vertical ladder with major/minor distinction.

**Requirements:**
- Vertical price ladder, highest price at top
- Major levels: bold, gold (#fbbf24), 21px, gold background
- Minor levels: thinner, muted (#b8b5ac), 17px
- Support labels (S) on left in green, resistance labels (R) on right in red
- Current price as highlighted blue band (manual input for now, live feed later)
- Levels near current price get blue border-left highlight
- Stats bar at bottom: total supports, total resistances, total levels, major count
- Empty state: centered icon + "Paste Email" prompt

**Future enhancements:**
- Click a level to mark it as "hit" (dims it)
- Click a level to set a price alert
- Live price auto-scrolls the ladder to keep current price visible
- Mini-map sidebar showing where you are in the full ladder

### Screen 2: Game Plan

**Replaces:** The structured handwritten summary the user writes from the email.

**Current state:** Built. Shows bull/bear paths and trigger cards.

**Requirements:**
- Two-column layout: bull path (green) on left, bear path (red) on right
- Each path is a vertical chain of price targets
- Targets that price has passed through dim to 30% opacity
- Trigger cards below: plain-English if/then rules
- ES price numbers highlighted in gold within trigger text
- All fields editable by tapping (future)

**Future enhancements:**
- Interactive flowchart/decision tree visualization
- Editable fields — tap any target or trigger to modify
- "Active branch" highlighting that follows price in real time
- Direct bid levels section (personal entry shortlist)

### Screen 3: Trade Log

**Replaces:** Handwritten P&L math, position sizing, equity tracking.

**Current state:** Built. Entry/exit logging with auto P&L calculation.

**Requirements:**
- "New Trade" button → form: symbol, direction (long/short toggle), entry price, contracts, setup type
- 75% exit: enter price, app calculates P&L for 75% of contracts
- Runner exit: enter price, app calculates remaining 25% P&L
- Trade list: most recent first, open trades have blue border
- Each trade shows: direction arrow, symbol, entry, exits, qty, setup tag, P&L
- Inline edit via ✎ button for adding exits
- Delete via ✕ button
- P&L auto-calculates using point value × contracts × price diff × direction

**Future enhancements:**
- Equity curve chart (line chart of cumulative P&L over sessions)
- Win rate / average win / average loss statistics
- Trade notes field
- Filter by setup type to analyze which setups are most profitable
- Export to CSV

## Feature Roadmap

### Phase 1 ✅ — Core Dashboard
- [x] Level ladder with parsed supports/resistances
- [x] Game plan with bull/bear paths and triggers
- [x] Trade log with P&L calculation
- [x] Email paste + parser
- [x] Supabase database backend
- [x] Dark trading theme

### Phase 2 ✅ — Sessions & History
- [x] Session date architecture (plans + trades linked by date)
- [x] Date navigator in header (◄ ► arrows)
- [x] Historical session browsing
- [x] Parser extracts session date from email subject

### Phase 3 ✅ — Multi-Tenant Auth
- [x] Supabase Auth (email/password)
- [x] Login / signup pages
- [x] Row Level Security (per-user data isolation)
- [x] Middleware route protection
- [x] Sign out functionality

### Phase 4 — Inbound Email Pipeline (replaces Zapier plan)
- [ ] Resend account + DNS setup on `inbound.tradeladder.io` (MX, SPF, DKIM)
- [ ] Per-user inbound address: `u-{user_id_short}@inbound.tradeladder.io`
- [ ] User configures email-forwarding rule in their personal mailbox (from Mancini → forward to per-user address)
- [ ] Resend webhook → `/api/inbound-email` with HMAC signature validation
- [ ] Auto-load: user opens app, today's plan is already there
- [ ] Manual paste path (existing) preserved as fallback
- [ ] Settings UI shows the user their inbound address (copy-to-clipboard)
- [ ] **Why not Zapier**: third-party processor of Mancini's content = IP risk; rejected during CEO review

### Phase 5 — OpenAI gpt-5.5 Parsing (replaces regex parser)
- [ ] Replace regex parser with OpenAI gpt-5.5 + structured outputs (`response_format: json_schema`, `strict: true`)
- [ ] Zod validates the response shape post-parse
- [ ] Regex parser kept as catch-block fallback at the route level (not inside the LLM parser)
- [ ] More robust handling of email format variations (holiday short emails, multi-day plans, format drift)
- [ ] Extract scenario narratives, not just price targets
- [ ] Confidence scoring on parsed levels (visible in UI via E5 confidence flags)
- [ ] Cache by `(email_hash, parser_version)` to avoid re-parsing
- [ ] **Eval discipline**: human-labeled ground-truth set in `tests/parser-eval/`; CI runs on every parser-prompt change

### Phase 6 — Live Price Feed
- [ ] Databento integration for real-time ES price
- [ ] Auto-updating price marker on level ladder
- [ ] Auto-highlighting active zone in game plan
- [ ] Proximity alerts when price approaches key levels

### Phase 7 — Analytics & Reporting
- [ ] Equity curve chart (daily/weekly/monthly views)
- [ ] Win rate by setup type
- [ ] Average R:R ratio
- [ ] Best/worst sessions
- [ ] CSV export

### Phase 8 — SaaS Launch
- [ ] Stripe billing integration
- [ ] Pricing page / plan selection
- [ ] Landing page at tradeladder.io
- [ ] Onboarding flow for new users
- [ ] Admin dashboard for user management

### Phase 9 — Mancini Partnership
- [ ] Approach Mancini with demo video + usage data
- [ ] Negotiate revenue share or licensing deal
- [ ] Integration with his Substack (direct content feed vs email parsing)
- [ ] Co-branded launch to his subscriber base

### Phase 10 — Platform Expansion
- [ ] Support additional trading newsletter authors
- [ ] Configurable parser for different email formats
- [ ] Community features (share setups, compare notes)
- [ ] Mobile responsive design

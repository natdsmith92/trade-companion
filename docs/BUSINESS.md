# Business Case

## Problem

Adam Mancini publishes a daily trade plan for ES futures via his Substack newsletter (tradecompanion.substack.com). He's ranked #6 in Finance on Substack and is among the platform's top 10 highest-earning publications. He has ~213K followers on X and has published over 1,371 daily issues.

Every one of his subscribers receives the same email: a narrative trade plan containing support/resistance levels, bull/bear scenarios, conditional triggers, and a directional lean. Every subscriber then has to manually:

1. Read and digest the email
2. Extract 50+ support/resistance levels (tagged major/minor)
3. Write out bull/bear scenarios and if/then trigger rules
4. Draw levels as horizontal lines on their charting platform
5. During the session: track entries/exits, calculate P&L by hand
6. Repeat the next day

This manual workflow takes 15-30 minutes of prep and constant paper-based tracking throughout the trading session. No tool exists that bridges the gap between "read the email" and "execute the plan."

## Solution

TradeLadder is a web-based companion dashboard that:
- Automatically ingests Mancini's daily email (via Zapier webhook or manual paste)
- Parses all levels, scenarios, and triggers into structured data
- Displays levels on an interactive vertical price ladder
- Shows bull/bear scenario paths and conditional triggers as a visual game plan
- Provides a trade log with auto-calculated P&L using Mancini's 75/25 rule
- Archives every session for historical review
- Works alongside existing trading platforms (not a replacement)

## Market Size

### Mancini's Subscriber Base
- Ranked #6 in Finance, top 10 in overall Substack earnings
- Top 10 Substack publications collectively earn $25M+ annually
- At estimated 3,000-10,000 paid subscribers at $30-50/month each
- Every subscriber experiences the same workflow pain

### Proven Demand for Tooling
- **TradingView indicator by ES-Money-Printer:** 7,022 uses, 1,630 favorites in ~8 months
  - This indicator only does ONE thing: display pasted levels as horizontal lines
  - Users must still manually copy-paste levels from the email every day
- **Multiple competing indicators:** At least 5 different TradingView scripts built specifically for Mancini's levels (ZawTrader, l-a-n-c-e, bitjanitor, dclewis221)
- **Aeromir level converter:** Converts ES levels to SPX prices
- **The Money Printer (themoneyprinter.io):** Full SaaS built around Mancini's methodology
  - Charges $49-$300/month across three tiers
  - Has a "Mancini Parser" as a top-level product feature
  - 7,000+ users on their free TradingView indicator
  - Notably states: "I already have this automated for NinjaTrader, but need to reach an agreement with Adam Mancini before public release"

### What This Tells Us
- Thousands of traders are actively building DIY tools around Mancini's content
- They're paying $49-$300/month for adjacent tooling
- No one has built the simple, accessible companion tool for non-technical traders
- No one has a licensing deal with Mancini

## Competitive Landscape

### The Money Printer (themoneyprinter.io)
- **What they built:** Full indicator/strategy suite + Mancini parser
- **Pricing:** $49/mo (Core), $99/mo (Expert), $300/mo (Elite)
- **Target user:** Technical, quantitative traders who use NinjaTrader/TradingView scripting
- **Weakness:** Extremely complex — 100+ variable inputs, C# execution engines, strategy backtesting. Not built for the average Mancini subscriber who can't write code
- **IP risk:** Uses Mancini's name extensively without visible partnership or licensing

### TradingView Indicators (various)
- **What they do:** Display manually-pasted levels as horizontal lines on a chart
- **Pricing:** Free
- **Weakness:** Manual paste every day, no scenario parsing, no trade log, no P&L
- **They prove:** The demand exists, the format is parseable, the audience wants tooling

### Aeromir Level Converter
- **What it does:** Converts ES levels to SPX prices
- **Weakness:** Single-purpose utility, no dashboard, no trade management

### TradeLadder's Differentiation
- **Built for non-technical traders** — paper-simple UI, not a quant tool
- **End-to-end workflow** — from email to levels to game plan to trade log in one app
- **Automated ingestion** — Zapier pipeline eliminates manual copy-paste
- **Multi-tenant SaaS-ready** — user accounts, RLS, session history
- **IP-clean positioning** — designed to partner with Mancini, not build around him

## Revenue Model

### Phase 1: Free (Dad Tool)
- Build and validate with a single user
- Prove the parsing works reliably across daily email variations
- Build a library of session screenshots and P&L data for the pitch

### Phase 2: Pitch to Mancini
- Approach with a working product + demo video
- Propose a revenue-share or licensing deal
- He keeps writing the email; TradeLadder makes it interactive
- His subscribers get more value → higher retention → he earns more

### Phase 3: SaaS Launch
- Pricing: $15-25/month on top of Mancini's subscription
- At 10% attach rate on 5,000 subscribers = 500 paying users
- At $20/month = $10,000/month recurring revenue
- At 20% attach rate = $20,000/month
- Infrastructure costs: ~$50-100/month (Render + Supabase Pro)

### Phase 4: Expand
- Add more newsletter authors (other trading educators with similar formats)
- Add Stripe billing
- Add live ES price feed (Databento or Polygon.io)
- Add Claude API for intelligent email parsing (vs regex)

## Go-To-Market Strategy

### Step 1: Build credibility
- Use the app daily with real Mancini emails
- Document parsing accuracy and edge cases
- Track real P&L data over weeks

### Step 2: Approach Mancini
- DM on X (@AdamMancini4) — his only active social channel
- Lead with the working product, not a pitch deck
- Show a 2-minute demo video: email → parsed levels → game plan → trade log
- Emphasize: "This increases the value of your newsletter without changing your workflow"

### Step 3: Soft launch to subscribers
- Mancini mentions it in his newsletter or X
- Limited beta for existing subscribers
- Gather feedback and iterate

### Step 4: Scale
- Open signups with Stripe billing
- Add features based on subscriber feedback
- Monitor The Money Printer's moves and differentiate on simplicity

## Key Risks

### IP / Content Rights
- Mancini's levels, analysis, and methodology are his intellectual property
- Any app that ingests his paid content needs his explicit permission
- Approaching as a partner (revenue share) rather than building around him is essential
- The Money Printer's experience ("need to reach an agreement with Adam Mancini") confirms this

### Parser Reliability
- Mancini's email format is consistent but not machine-structured
- Edge cases in phrasing, ranges, and scenario descriptions
- Mitigation: Claude API parsing as Phase 5 upgrade (much more robust than regex)

### Market Dependency
- Product value is entirely tied to Mancini continuing to publish
- If he stops, changes format, or builds his own tool, the product loses its purpose
- Mitigation: expand to other trading newsletter authors

### Competition
- The Money Printer already has 7,000+ users and charges premium prices
- They may accelerate their product if they see TradeLadder
- Advantage: they serve the quant crowd; TradeLadder serves the pen-and-paper crowd

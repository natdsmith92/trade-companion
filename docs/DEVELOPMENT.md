# Development Notes

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase keys

# Run development server
npm run dev
# → http://localhost:3000
```

## Deployment (Render)

- **Build Command:** `npm run build`
- **Start Command:** `npm start`
- **Auto-deploy:** Push to `main` branch on GitHub → Render rebuilds
- **Environment variables:** Set in Render dashboard → Environment tab

## Database Migrations

All SQL files are in the project root. Run them in Supabase Dashboard → SQL Editor:

| File | When to run |
|---|---|
| `schema.sql` | Fresh setup — creates tables from scratch |
| `migrate-session-date.sql` | If tables exist without session_date column |
| `migrate-multi-tenant.sql` | If tables exist without user_id and RLS |

Always run migrations in Supabase SQL Editor, not via CLI.

## Code Patterns

### API Routes
All API routes follow the same pattern:
```typescript
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    // ... query logic
    if (error) {
      console.error("Descriptive error:", error);
      return NextResponse.json({ error: "User-facing message" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("Handler error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
```

### Client Components
- All interactive components use `"use client"` directive
- State managed with `useState` / `useEffect` hooks
- API calls via `fetch()` — no external data-fetching library
- Errors handled silently (no modals) with inline messages

### Styling
- Tailwind CSS utility classes for layout and spacing
- CSS custom properties (variables) for the color system via inline `style={}` props
- No component library (shadcn/ui planned for future)
- Monospaced font class: `className="mono"` for all price/number displays

### Color System
```css
--bg-0: #0c0d10    /* deepest background */
--bg-1: #13141a    /* panels, header */
--bg-2: #1a1b22    /* cards */
--bg-3: #22232c    /* inputs, nested elements */
--border: #2a2b36  /* subtle borders */
--text-1: #f0ede6  /* primary text */
--text-2: #b8b5ac  /* secondary text */
--text-3: #7d7a72  /* labels */
--text-4: #55534d  /* disabled/muted */
--bull: #2dd4a0    /* bullish / profit / long */
--bear: #f87171    /* bearish / loss / short */
--gold: #fbbf24    /* major levels / highlights */
--blue: #60a5fa    /* current price / interactive */
```

## Adam Mancini's Email Format Reference

### Level Format (highly consistent)
```
Supports are: 6685 (major), 6676, 6667, 6663 (major), 6656, 6652 (major)...
Resistances are: 6693, 6700 (major), 6704, 6711, 6716 (major)...
```

Rules:
- Each level is a 4-5 digit number
- `(major)` tag = major level, absence = minor
- Comma-separated
- Ranges: "6778-82" = 6778 to 6782, "6820-6822" = 6820 to 6822

### Subject Line Format
```
"7 Green Days In A Row For SPX. Can It Do 8? April 15 Plan"
"Is Buy The Dip Back In SPX? April 14 Plan"
"SPX Puts In Biggest Green Week Since June 2025. Will It Run Next Week? April 13 Plan"
```

The session date is typically at the end: "April 15 Plan" → 2026-04-15.

### Scenario Format
```
Bull case tomorrow:
  Pop to 6700, 6716, 6738, then 6758-65.

Bear case tomorrow:
  Below 6685 → 6663 → 6652 → 6624 → 6612.
  If 6612 fails, new lows.
```

### Conditional Triggers
```
If ES can tag 6612 and recover 6624, this is very high quality.
If 6612 fails we probably make new lows.
I'd watch for a big Failed Breakdown of Sunday's 6585.
If we can tag 6571 and recover this, its an excellent trade.
```

### Directional Lean
```
My general lean is bulls can try to backtest it.
```

## Mancini's Trading Methodology

### Three Core Setups
1. **Bull/Bear Flags** — basing/consolidation patterns near a level
2. **Failed Breakdown** (PRIMARY) — price breaks below a level, then recaptures it. Buy the recapture.
3. **Trendline Trades** — buy rising trendlines, sell falling ones

### Trade Management (75/25 Rule)
- Enter at one level
- Take 75% profit at the first immediate target level
- Leave 25% as a risk-free runner with break-even stop
- Gradually trail the stop up on the runner
- Most runners get stopped out by design — this is expected

### Contract Specifications
| Symbol | Name | Point Value | Tick Size |
|---|---|---|---|
| ES | E-mini S&P 500 | $50/point | 0.25 |
| MES | Micro E-mini S&P 500 | $5/point | 0.25 |
| MNQ | Micro E-mini Nasdaq 100 | $2/point | 0.25 |
| NQ | E-mini Nasdaq 100 | $20/point | 0.25 |

Quarter codes: H=March, M=June, U=September, Z=December
Example: ESM26 = E-mini S&P 500, June 2026

## The User's Current Workflow

### Platforms
- **Optimus Flow (Ironbeam/Certigo)** — Futures execution. DOM ladder, order entry. This is where trades are placed.
- **ThinkorSwim (Schwab)** — Charting only. He manually draws horizontal lines at Mancini's levels. No scripting. Also watches/trades ETFs.
- **Pen and paper** — Everything else. THIS IS WHAT TRADELADDER REPLACES.

### Daily Routine
1. ~4pm: Reads Mancini's email
2. Writes out: directional lean, bull/bear scenarios, levels, triggers
3. Draws key levels on TOS charts
4. During session: logs entries/exits on paper, calculates P&L by hand
5. Tracks account equity day over day in a running list

## Email Ingestion Pipeline

### Current: Zapier (free tier)
```
Mancini email → Gmail → Zapier detects it → POST /api/ingest → Supabase
```
- Zapier free tier: 100 tasks/month
- One email per day × 2 tasks (trigger + action) = ~44 tasks/month
- Zapier polls Gmail every 15 minutes on free tier

### Future Options
- **Databento** for live ES price feed ($125 free credits, pay-per-use after)
- **Polygon.io/Massive** for delayed or real-time price data ($29-199/month)
- **Claude API** for intelligent email parsing (replace regex with LLM)

## Known Issues / TODOs

### Parser Edge Cases
- Ranges in the middle of level lists sometimes misparse
- Some emails have non-standard bull/bear section headers
- Lean extraction is fragile — depends on the word "lean" appearing
- Session date extraction needs more subject line pattern coverage

### Missing Features
- No live price feed (currently manual input)
- No equity curve chart (trade P&L accumulates but isn't visualized)
- No export/download of trade history
- No email notifications or alerts at key levels
- No mobile responsive design (desktop-first, multiple monitors)

### Auth / Multi-tenant
- Email confirmation flow needs testing across email providers
- Password reset flow not yet implemented
- Zapier webhook needs a way to map subscriber emails to user_ids
- No admin panel for managing users

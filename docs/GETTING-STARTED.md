<!-- generated-by: gsd-doc-writer -->
# Getting Started

A sequential, copy-paste path from a fresh clone to a running TradeLadder dashboard
on your machine. Every step has a verifiable outcome — if a step doesn't produce
what's described, stop and fix it before moving on.

## Who this is for

A new contributor or someone forking TradeLadder. We assume you know `git` and
`npm`, but not the specifics of this project. By the end of this doc you will
have the dev server running, an account created, and a Mancini email parsed
into the dashboard.

If you only want to read the architecture, skip to [`ARCHITECTURE.md`](./ARCHITECTURE.md).
If you only want to fix a bug, skim this then jump to [`DEVELOPMENT.md`](./DEVELOPMENT.md).

## 1. Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | `>= 18.18` | Next.js 15 requires it. `package.json` does not pin an `engines` field, so any 18.18+ or 20.x LTS works. |
| npm | bundled with Node | Used by all scripts in [`package.json`](../package.json). |
| Git | any recent | For cloning. |
| Supabase project | free tier is fine | Database + auth. Sign up at [supabase.com](https://supabase.com/). |
| OpenAI API key | any account with credits | Required for the TL;DR feature; the server crashes on boot without it (see [`src/lib/env.ts`](../src/lib/env.ts) lines 13-18). |

`bun` is **not required** — none of the scripts assume it. If you happen to use
it locally, the `package.json` scripts (`next dev`, `next build`, `next start`)
work the same way under `bun run`.

## 2. Clone and install

```bash
git clone <your fork's URL> tradeladder
cd tradeladder
npm install
```

**Windows note:** if your clone path contains spaces (the default OneDrive /
Documents location does), wrap the path in double quotes when running shell
commands. PowerShell handles this fine; bash on Windows requires the quotes.
Stick to forward slashes inside scripts.

## 3. Set up Supabase

1. In the Supabase dashboard, create a new project. Pick any region near you.
2. Open **SQL Editor**.
3. Run the canonical schema in one shot — paste the contents of
   [`schema.sql`](../schema.sql) and click **Run**. This creates `plans`,
   `trades`, `es_price_cache`, all RLS policies, indexes, and the `tldr` jsonb
   column on `plans`.

If you already have an older Supabase project, run the migrations in order
instead of `schema.sql`. Per [`docs/CONFIGURATION.md`](./CONFIGURATION.md#migrations-on-a-fresh-supabase) the order is:

1. [`migrate-session-date.sql`](../migrate-session-date.sql)
2. [`migrate-multi-tenant.sql`](../migrate-multi-tenant.sql)
3. [`migrate-trade-idempotency.sql`](../migrate-trade-idempotency.sql)
4. [`migrate-es-price-cache.sql`](../migrate-es-price-cache.sql)
5. Manually add `tldr jsonb` to `plans` (the comment at the top of `schema.sql` notes this was added via the dashboard).

**Verify:** in **Table Editor** you should see three tables: `plans`, `trades`,
`es_price_cache`. The `es_price_cache` table should already have one row with `id = 1`.

## 4. Set up environment variables

```bash
cp .env.example .env.local
```

Fill in the four required values. All four come from the Supabase + OpenAI
dashboards:

| Variable | Where to find it |
|----------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → **Project Settings → API** → "Project URL". |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → **Project Settings → API** → "Project API keys" → `anon` / `public`. |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → **Project Settings → API** → "Project API keys" → `service_role`. **Never commit this** — it bypasses RLS. |
| `OPENAI_API_KEY` | OpenAI dashboard → **API Keys** → create a new secret key. |

The optional `RESEND_*` and `ADMIN_*` keys in `.env.example` are for
unshipped features — leave them commented out.

The four required keys are validated at server startup by `assertEnv()` in
[`src/lib/env.ts`](../src/lib/env.ts). If any are missing, the dev server
exits immediately with `Missing required env: …`.

## 5. (Optional) Set up Google OAuth

The login page offers a "Continue with Google" button
([`src/app/login/page.tsx`](../src/app/login/page.tsx) lines 31-39). To enable it:

1. Supabase dashboard → **Authentication → Providers → Google** → toggle on.
2. Add a Google Cloud OAuth client (Supabase's UI links to a setup guide).
3. In Supabase **Authentication → URL Configuration**, set Redirect URL to
   `http://localhost:3000/auth/callback` for local dev.

**Skip note:** email/password signup works without Google OAuth. You only need
this if you want the Google button to actually log you in.

## 6. Run the dev server

```bash
npm run dev
```

This runs `next dev` (see [`package.json`](../package.json) line 6) on
`http://localhost:3000`.

**Verify:** open [http://localhost:3000](http://localhost:3000). The middleware
in [`src/middleware.ts`](../src/middleware.ts) line 38-42 should redirect you
to `/login` because you are not authenticated. If you see the login page, env
loaded correctly and the server is healthy.

## 7. Sign up and log in

1. On `/login`, click **Sign up** at the bottom.
2. Enter an email + password, submit.
3. If Supabase has email confirmation enabled (default), check your inbox for the
   confirmation link. The callback handler is at [`src/app/auth/callback/route.ts`](../src/app/auth/callback/route.ts).
4. Once confirmed, log in. You should land on `/` — the main dashboard with the
   ladder, game plan, and trade log tabs.

## 8. Paste a Mancini email

The dashboard is empty until you ingest a plan.

1. Click the **Paste** button in the header. The modal in
   [`src/components/PasteModal.tsx`](../src/components/PasteModal.tsx) opens.
2. Paste the body of a real Mancini Substack email. Any recent daily plan works.
3. Submit. The client POSTs to `/api/ingest`, which writes a row to `plans`
   keyed to today's `session_date` and your `user_id`.

**Verify:** the **Ladder** tab populates with extracted price levels, and the
**Game Plan** tab shows bull/bear scenarios. The TL;DR tab calls OpenAI lazily
on first view — give it a few seconds.

## 9. Verify health

```bash
curl http://localhost:3000/api/health
```

Expected response (200 OK):

```json
{
  "ok": true,
  "checks": {
    "env": { "ok": true, "detail": "all required keys present" },
    "supabase": { "ok": true, "ms": 87 },
    "esPriceCache": { "ok": true, "ms": 12345, "detail": "Xm old" }
  }
}
```

The endpoint is implemented in [`src/app/api/health/route.ts`](../src/app/api/health/route.ts).
A 503 response means at least one check failed — the `detail` field tells you which.

`esPriceCache` may be flagged stale (`ok: false`) on first run because no quote
has been written yet. That is expected locally; the F8b pre-warmer (production
cron job) is what keeps it fresh in deploy.

## 10. Common issues

- **Server crashes on `npm run dev` with `Missing required env: …`** — one of
  the four required keys is missing or misspelled in `.env.local`. The exact
  missing key is named in the error message. See `src/lib/env.ts` lines 21-28.
- **Login works but the dashboard never loads / API calls return 401 or empty
  data** — RLS is rejecting your reads. Almost always means you ran one
  migration but not all of them. Re-run [`schema.sql`](../schema.sql) on a
  fresh Supabase project, or compare the policies on `plans` and `trades` in
  Supabase **Authentication → Policies** to those listed in `schema.sql`
  lines 65-95.
- **Pasting an email returns 500 / nothing populates** — check the dev server
  logs. Either the parser didn't recognize the format (older or non-Mancini
  email) or `SUPABASE_SERVICE_KEY` is wrong (the ingest route uses the admin
  client). The ingest endpoint is at `src/app/api/ingest/route.ts`.
- **Live ES price doesn't load / stays at zero** — Yahoo Finance may have rate
  limited your IP. The `es-price` route falls back to the cached row in
  `es_price_cache` and returns `stale: true`. See [`docs/CONFIGURATION.md`](./CONFIGURATION.md#yahoo-finance-configuration)
  for the cache TTL and fallback behavior.
- **Email confirmation link points to production** — Supabase **Authentication →
  URL Configuration** → Site URL is set to the production domain. Override it to
  `http://localhost:3000` for local dev, or click the link and manually
  copy the token portion to `localhost:3000/auth/callback?…`.

## Next steps

Once the dashboard is running and you've ingested a plan, head to
[`docs/DEVELOPMENT.md`](./DEVELOPMENT.md) for the contributor workflow —
how the codebase is organized day-to-day, how to add features, and the
review process.

<!-- generated-by: gsd-doc-writer -->
# Development

Day-2 contributor doc. Read [GETTING-STARTED.md](GETTING-STARTED.md) first if you
have not booted the app yet. This file is the rule book for adding things, the
gotchas you will hit, and the conventions every PR is held to.

For boundaries between modules see [ARCHITECTURE.md](ARCHITECTURE.md). For env
keys see [CONFIGURATION.md](CONFIGURATION.md). For HTTP shapes see
[API.md](API.md).

---

## Mental Model

Three layers, kept deliberately thin:

1. **Shell** — `src/app/page.tsx`. A client component that wires hooks together,
   owns three pieces of UI state (`activeTab`, `showPaste`, `showNewTrade`,
   `editTradeId`), and renders the `<Header>` + sidebar + tab content + bottom
   `<TradeBar>`. No business logic lives here. ([src/app/page.tsx:33-182](../src/app/page.tsx))
2. **Hooks (data + actions)** — `src/hooks/*`. Each hook owns one slice of state
   and the network calls that mutate it. The shell composes them. Examples:
   `useSessions` (date list + navigator), `useParsedPlan` (parse + ingest),
   `useTrades` (CRUD over `/api/trades`), `useESPrice` (15s polling),
   `useManualPrice` (override layer over the live feed), `useAuth`.
3. **Presentation** — `src/components/*`. Dumb-ish: take props, render. The
   risky ones (`LevelLadder`, `GamePlan`, `TradeStats`, `TldrTab`) are wrapped in
   `<ErrorBoundary label="...">` per tab so a render bug in one tab does not
   blank the whole app. ([src/app/page.tsx:101-150](../src/app/page.tsx),
   [src/components/ErrorBoundary.tsx](../src/components/ErrorBoundary.tsx))

If you find yourself adding `useState` to `page.tsx` for anything more than UI
flags, that state probably belongs in a hook.

---

## Adding a New API Route

Routes live under `src/app/api/<name>/route.ts` (Next.js App Router file
convention). Dynamic segments use `[id]` folders — see
`src/app/api/trades/[id]/route.ts`.

**Skeleton:**

```typescript
// src/app/api/example/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    // ... query
    if (error) {
      console.error("Example fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch X" }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("Example handler error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
```

**Pick the right Supabase client:**

| Client | Source | When to use |
|---|---|---|
| `createServerSupabase()` | [src/lib/supabase-server.ts:6](../src/lib/supabase-server.ts) | Default. Authenticated as the logged-in user via cookies. RLS applies. Use this for every user-scoped read/write. |
| `createAdminSupabase()` | [src/lib/supabase-server.ts:31](../src/lib/supabase-server.ts) | **Bypasses RLS.** Only for the singleton `es_price_cache`, the `/api/health` probe, and the upsert side of `/api/ingest` (which still derives `user_id` from the auth client first — see below). |
| `createBrowserSupabase()` | [src/lib/supabase-browser.ts](../src/lib/supabase-browser.ts) | Client components only (e.g. `useAuth`). |

**Auth (F2 pattern).** Never read `user_id` from the request body. Get it from
the session cookie:

```typescript
const auth = await createServerSupabase();
const { data: { user } } = await auth.auth.getUser();
if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
// now use user.id, never body.user_id
```

This is what closes the original `/api/ingest` hole — see
[src/app/api/ingest/route.ts:23-29](../src/app/api/ingest/route.ts) and
[src/app/api/trades/route.ts:39-42](../src/app/api/trades/route.ts).

**Idempotency (F10 pattern).** If clients can double-submit (fast tap, retry),
accept an `idempotency_key` from the body and short-circuit on hit:

```typescript
if (body.idempotency_key) {
  const { data: existing } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", user.id)
    .eq("idempotency_key", body.idempotency_key)
    .maybeSingle();
  if (existing) return NextResponse.json(existing);
}
```

The DB enforces this with a partial unique index on
`(user_id, idempotency_key)` ([schema.sql:60-63](../schema.sql)). Client side,
generate the key with `crypto.randomUUID()` and stash it in a `useRef` so it is
stable for the lifetime of the modal — see
[src/components/TradeLog.tsx](../src/components/TradeLog.tsx) (`idempotencyKeyRef`).

**Public routes.** Middleware redirects unauthenticated requests to `/login`.
If a new route is genuinely public (a webhook, a status endpoint, the `/auth/callback`
page), add it to `publicPaths` in
[src/middleware.ts:34](../src/middleware.ts). Today's allowlist is
`["/login", "/signup", "/auth/callback", "/api/health"]`. Webhooks should still
authenticate — just by signature instead of session (Phase 4 `/api/inbound-email`
will use HMAC).

**Logging.** Always `try/catch` the handler body, `console.error` with a tag
that names the route, and return a generic JSON `{ error }` shape with a status
code. Never let a stack trace leak in the response.

---

## Adding a New Hook

- Naming: `useThing`. One file: `src/hooks/useThing.ts`.
- Always `"use client"` at the top.
- Export a single named hook plus its return-shape interface (e.g.
  `TradesState`, `SessionsState`, `ParsedPlanState`). The shape is `{ ...data,
  ...actions }` — no React internals leak out.
- Internal `fetch` calls go straight to `/api/...`. No data-fetching library —
  this app does not use SWR or react-query. Errors are swallowed silently in
  most flows (no error toasts) — see
  [src/hooks/useTrades.ts:23-25,40-43](../src/hooks/useTrades.ts).
- Keep effects pure: an effect should depend only on its declared dependencies.
  See `useParsedPlan` for an example of a deliberate ref-based escape valve
  (`justPastedDateRef`) when fetch + local-state ordering needs to be defended.

**When to put state in a hook vs a component:** if more than one component
reads or mutates the state, hoist it to a hook in `src/hooks/`. If only one
component cares, leave it inline. The shell (`page.tsx`) is the typical reader
for cross-cutting hooks; tab-specific concerns can live in their components.

---

## Adding a New Component

- Flat directory: `src/components/Thing.tsx`. No nested `Thing/index.tsx` —
  keep the layout boring.
- TypeScript `interface` (or `type`) for props. Co-locate it above the
  component definition.
- `"use client"` for anything interactive (state, effects, handlers). Static
  presentational components can omit it.
- Wrap risky renders in `<ErrorBoundary label="Component Name">`. Risky =
  reads parsed/AI-generated data that could be malformed (the level ladder, the
  game plan, the TL;DR tab). Each dashboard tab in `page.tsx` already gets one
  ([src/app/page.tsx:101,130,142,147](../src/app/page.tsx)).
- Reach for the existing CSS variables in `src/app/globals.css` before
  introducing new colors — see the README for the palette.
- Monospace number class is `className="mono"`. Use it on every price/quantity
  the user reads.

---

## Database Changes

1. Write a `migrate-<feature>.sql` at the project root. Idempotent SQL only —
   `create table if not exists`, `alter table ... add column if not exists`,
   `create index if not exists`, `create policy ...` guarded by a check. Look
   at `migrate-trade-idempotency.sql` and `migrate-es-price-cache.sql` for the
   pattern.
2. Apply it via the **Supabase dashboard SQL editor**. There is no migration
   CLI. Note in the commit message which environment(s) you ran it on.
3. Fold the change into [schema.sql](../schema.sql) so a fresh deploy from
   scratch lands with all migrations applied. Keep schema.sql canonical — it
   is the single source of truth for "what does the DB look like right now."
4. **Any user-scoped table needs RLS.** The pattern from
   [schema.sql:65-95](../schema.sql):
   ```sql
   alter table foo enable row level security;
   create policy "Users can view their own foo"
     on foo for select using (auth.uid() = user_id);
   -- ... insert / update / delete policies ditto
   ```
5. The service-role key (`SUPABASE_SERVICE_KEY`, used by `createAdminSupabase`)
   bypasses RLS entirely. That is the escape hatch for the singleton cache and
   the `/api/ingest` upsert, **not** a way to skip writing RLS policies.

---

## Environment Variables

Adding a required env var means **all three** of these:

1. **Add it to the `REQUIRED` array** in
   [src/lib/env.ts:13-18](../src/lib/env.ts) and to the `ServerEnv` interface
   above it. Mirror the same key in `envStatus()` so `/api/health` reports it.
2. **Add it to [.env.example](../.env.example)** with a placeholder value and a
   one-line comment if its purpose is non-obvious.
3. **Document it in [docs/CONFIGURATION.md](CONFIGURATION.md)** — the table is
   the source of truth a new contributor reads.

`assertEnv()` runs once on server startup via
[src/instrumentation.ts](../src/instrumentation.ts) and crashes the process if
any required key is missing. Validation is gated on
`process.env.NEXT_RUNTIME === "nodejs"` so `next build` still succeeds in CI
without real keys present — that is by design (see "Sharp edges" below).

---

## Error Handling

- Routes: `try/catch` everything. `console.error` with a tag (`"Trade insert
  error:"`, `"TL;DR fetch error:"`). Return structured `NextResponse.json({
  error: "..." }, { status })`. Never include the raw error object or a stack
  trace in the response.
- Status codes used today: `400` (missing/invalid input), `401` (no session),
  `404` (no row found), `500` (server error), `502` (upstream failure — see
  Yahoo path in `/api/es-price`), `503` (degraded — `/api/health` returns this
  when env or Supabase are down, also `/api/tldr` when generation fails).
- Client hooks: swallow fetch errors (`.catch(() => {})`) for non-critical UI.
  Auth-related redirects belong in `middleware.ts`, never in a hook.
- Render errors: trust the `<ErrorBoundary>`. Class component because React has
  no hook for `componentDidCatch`. The boundary logs to `console.error` with
  the component label so you can grep Render logs by tab name.

---

## TypeScript

`strict: true`, `noEmit: true`, `target: ES2017`, path alias `@/* → ./src/*`
([tsconfig.json](../tsconfig.json)).

There is no standalone typecheck script. Run:

```bash
node_modules/.bin/tsc --noEmit
```

`next build` also runs the type-checker and will fail the build on type errors,
so a green `npm run build` is the de facto typecheck gate.

---

## Code Style

- Functional React components. Hooks. No classes except `ErrorBoundary`.
- Plain naming: `TradeLog`, `LevelLadder`, `GamePlan`, `useSessions`. No
  `*Container`, no `*Provider` wrappers, no factory abstractions.
- **Comments explain WHY, not WHAT.** If a comment describes what the next
  line does, delete it. If a comment explains a non-obvious choice (a race,
  an ordering invariant, a fallback semantic, why an admin client is being used
  here), keep it. See the comment block in
  [src/hooks/useParsedPlan.ts:27-32](../src/hooks/useParsedPlan.ts) for the
  bar.
- No emojis in code, comments, or commit messages.
- No new dependencies without a reason. Today's deps: `@supabase/ssr`,
  `@supabase/supabase-js`, `next`, `openai`, `react`, `react-dom`,
  `yahoo-finance2`. Reach for the platform first.

---

## Build & Verify

```bash
npm run build
```

Should pass cleanly. Inspect the route table Next.js prints — every API route
under `src/app/api/**/route.ts` and every page under `src/app/**/page.tsx`
should appear. Today the build emits 16 routes:

- 3 pages: `/`, `/login`, `/signup`
- 1 route handler: `/auth/callback`
- 8 API routes under `/api/*` (`es-price`, `health`, `ingest`, `latest-plan`,
  `sessions`, `tldr`, `trades`, `trades/[id]`)
- Plus Next.js's internal `_not-found` and the routes-manifest entries

If you add a new route and it does not appear in the table, the file is in the
wrong location or the export name is wrong (must be `GET`/`POST`/etc., not
`default`).

---

## Testing

There is no test infrastructure today. No unit tests, no integration tests, no
E2E. The verification gates are: type-check (`tsc --noEmit`), build
(`npm run build`), and live `/api/health`.

Test infra is on the roadmap (Vitest + React Testing Library for unit, Playwright
for E2E, plus an LLM-eval suite for the parser and the TL;DR generator). When
that lands, a `docs/TESTING.md` will appear and this section will link there.

Until then: every change should be exercised manually against a local Supabase
project with a real Mancini email pasted in, plus `npm run build` clean.

---

## Commit Conventions

Read recent commits for the house style:

```bash
git log --oneline -20
```

The pattern is one of:

- `F<n>: <imperative summary>` for items shipped against a numbered F-list
  entry (e.g. `F2-partial + health upgrade + env validation`,
  `F10: Trade double-submit idempotency`).
- `<verb> <subject>` for one-off fixes (`Fix two dashboard bugs: date nav +
  paste race`).

Bodies are wrapped at ~72 columns and explain the **why** — what bug existed,
what invariant the fix preserves. Multi-line messages are passed via HEREDOC,
not a flag soup. AI-paired commits include the trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Commits are atomic per F-item or per fix. Do not bundle unrelated changes —
makes bisecting and reverting cleaner.

---

## Branching & PRs

Solo-dev workflow today. The `main` branch is the deploy branch — pushing to it
triggers Render auto-deploy. No staging environment.

- For trivial / safe changes (doc edits, config, isolated bugfix): commit
  straight to `main`.
- For risky changes (parser logic, schema, anything that touches auth or RLS,
  anything you cannot mentally verify in one read): branch, push, PR, merge
  yourself once `npm run build` is green and you have eyeballed the diff.

When the team grows past one, this section gets rewritten.

---

## Debugging

- **Live state of a deploy:** `GET /api/health` returns env presence,
  Supabase round-trip latency, and the age of the `es_price_cache` row. Returns
  503 if anything required is broken; UptimeRobot pages off this.
  ([src/app/api/health/route.ts](../src/app/api/health/route.ts))
- **Server logs:** `console.error` lines surface in the Render dashboard logs
  tab. Tag every log with the route or boundary name (`"[ErrorBoundary:Game
  Plan]"`, `"Trade insert error:"`) so you can grep them.
- **Cache busts after a deploy:** if you suspect a stale bundle is being served,
  diff the hash in `/_next/static/<hash>/_buildManifest.js` against the latest
  build commit.
- **Auth-related weirdness:** the middleware refreshes the session on every
  request via `supabase.auth.getUser()`
  ([src/middleware.ts:26-28](../src/middleware.ts)). If you see redirect loops
  between `/login` and `/`, your cookies are out of sync — clear site data and
  retry.
- **ES price stuck at zero:** check `/api/health` for the `esPriceCache` block.
  If `updated_at` is hours old, Yahoo is rate-limiting or the cookie wall has
  changed — see "Sharp edges" below.

---

## Known Sharp Edges

- **Env validation only fires at runtime, not build.**
  `instrumentation.ts:6` gates `assertEnv()` on `process.env.NEXT_RUNTIME ===
  "nodejs"`. `next build` does not set that variable, so a build can succeed
  with no env present and then the server can crash on first boot. This is
  intentional — Render's build container does not have prod secrets — but it
  means CI cannot catch a missing key. The first request after deploy is the
  test.
- **Yahoo Finance is fragile.** `/api/es-price` calls `yahoo-finance2`'s
  `quote("ES=F")`. Yahoo periodically rotates cookies, rate-limits, or returns
  partial payloads. The route falls back to the cached row marked `stale: true`
  ([src/app/api/es-price/route.ts:78-95](../src/app/api/es-price/route.ts)),
  which keeps the UI rendering a reasonable price. If the cache itself is cold,
  you get a 502. Plan B is the F8b pre-warmer (cron-style refresh outside the
  request path) and Plan C is paying for a real data feed.
- **OpenAI structured outputs are JSON-only.** `generateTldr` uses
  `response_format: { type: "json_object" }`
  ([src/lib/generate-tldr.ts:118](../src/lib/generate-tldr.ts)). If the model
  returns invalid JSON or the parsed shape does not match `TldrData` (no
  `stats` array, no `sections` array), the generator returns `null` and logs.
  The TL;DR tab then shows the un-generated fallback. Schema mismatches bubble
  up here — if you change `TldrData` in `src/lib/tldr-types.ts`, update
  `SYSTEM_PROMPT` and the validation block in `generateTldr` together.
- **`useParsedPlan` paste race.** Pasting an email triggers a local parse and a
  `setSessionDate` before the `/api/ingest` POST completes. Without the
  `justPastedDateRef` guard
  ([src/hooks/useParsedPlan.ts:32-69](../src/hooks/useParsedPlan.ts)), the
  `useEffect` fetch returns 404 and clears the just-set parse. Touch this hook
  carefully.
- **Date navigator direction.** Sessions arrive newest-first (idx 0 = newest).
  "Older" walks toward bigger indexes; "newer" walks toward smaller. The
  `NavDirection` type encodes this so `+1`/`-1` math cannot get inverted again
  ([src/hooks/useSessions.ts:6-11,49-55](../src/hooks/useSessions.ts)).
- **Render cold starts.** Module-level caches (e.g. an in-memory price cache)
  do not survive a cold start, and they diverge across instances under
  horizontal scaling. F6 moved the ES price cache into a Supabase singleton
  row for this reason. Avoid module-level mutable state for anything that
  must survive restarts or be shared.

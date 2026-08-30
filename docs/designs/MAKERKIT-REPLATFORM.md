---
status: ACTIVE
---
# TradeLadder: Zero-Touch Daily Ingest + MakerKit Re-Platform
CEO review 2026-08-30 (SELECTIVE EXPANSION) · Eng review 2026-08-30 · Two outside-voice passes
Branch: main | Repo: natdsmith92/trade-companion
Supersedes: the 2026-05-04 pitch-readiness sprint (stalled; last commit 2026-05-04, its own
drift cutoff of 2026-06-09 passed without action). That plan is archived outside this repo
at `~/.gstack/projects/natdsmith92-trade-companion/ceo-plans/archive/`.

Legend: `D<N>` = CEO-review decision · `Issue <N>` / `XM<N>` = CEO-review finding /
cross-model tension · `ENG <N>` = eng-review decision · `XM-ENG<N>` = eng-review
cross-model tension. All were explicitly approved by the user. Effort is dual-scale:
human-team / Claude Code assisted.

## Context

TradeLadder froze on 2026-05-04 with manual paste and Zapier still in the daily loop. Root
cause of the stall: the May plan shipped value last. This plan inverts that — and after the
outside voice caught it re-creating the same ordering, Phase 1 now ships working auto-import
to dad on the existing app before the re-platform completes (XM-ENG3).

Newsletter source (D3): Adam Mancini, tradecompanion.substack.com. Users (ENG 12A): ONE —
dad. Single personal account, one routing row.

### Ground truth (verified 2026-08-30 — each corrects an error an earlier draft made)

- **An unmerged branch holds the best version of this codebase.**
  `claude/gallant-faraday-fd559d` is 12 commits ahead of main, 46 files, +3,751/−787,
  pushed to origin, and checked out as a live worktree under `.claude/worktrees/`. It
  contains F1 (page.tsx → hooks + Header), F2 (env validation), F5 (**schema.sql reconciled
  to production reality**), F6 (persistent es-price cache), F7 (React error boundaries),
  F8b (**pg_cron parse-success monitor**), F9 (/admin/pitch gate), F10 (trade idempotency),
  regenerated docs, CHANGELOG at v1.1.0. A second worktree exists
  (`romantic-proskuriakova-9f4135`). Both the CEO and eng reviews missed this entirely.
- **main's `schema.sql` is stale and must not be the port source.** Zero references to
  `user_id`, `tldr`, or RLS, and NO unique constraints in any committed SQL — yet
  `/api/ingest` writes `tldr: null` and upserts `onConflict: "user_id,session_date"`. The
  live production schema is undocumented on main; the reconciled snapshot is on the branch.
- **There is NO LLM parser.** `src/lib/parser.ts::parseLevels()` is pure regex. The only
  OpenAI call is `src/lib/generate-tldr.ts` (`gpt-5.5`), which writes TL;DR prose. The LLM
  parser is net-new work.
- **`/api/ingest` has no authentication.** Listed in `publicPaths` (`src/middleware.ts:31`),
  accepts caller-supplied `user_id`, writes via admin client. `src/app/page.tsx:126`
  (PasteModal) calls the same route, so hardening requires splitting it.
- **The regex parser fails silently.** `parseLevels()` can return zero levels, and
  `fallbackNextTradingDay()` invents a session date when none is found.
- **No email provider and no test infrastructure.** `package.json` has no
  resend/postmark/nodemailer, and no vitest/jest/playwright config, no `test` script, zero
  test files.

## Approach (D4 → XM1 → XM-ENG3)

MakerKit re-platform, with the parser proven before the port AND working auto-import
delivered to dad before the port completes.

- Deploy target (D7): Vercel. Database (D8): fresh Supabase project + migration.
- Account model: MakerKit PERSONAL account; its `account_id` equals the auth user id, so
  account creation must precede the migration script.
- Provider (D9): **Postmark**, inbound and outbound. Chosen over Resend because no provider
  had incumbency, Postmark delivers the full parsed message in one webhook payload
  (deleting a follow-up body fetch), its Activity log doubles as a payload inspector and as
  the destination for Gmail's forwarding-confirmation code, and attachment size caps are
  irrelevant to a text newsletter. Accepted downgrade: Basic auth + IP allowlist instead of
  svix HMAC.
- Parser stays CONCRETE and Mancini-only (Issue 6B) — no source-adapter abstraction.

Rejected: bolting auto-import onto the old codebase *permanently*; full re-platform with
features last (the May ordering); codex's full prove-then-port inversion (XM1 B).

---

## Phase 0 — correct the baseline (existing repo)

**0.0 Merge `claude/gallant-faraday-fd559d` into main (XM-ENG1).** Do this FIRST. It makes
the port source truthful — reconciled schema, error boundaries, env validation, idempotency,
pg_cron. Resolve conflicts, QA the merged old app, then decide the fate of the second
worktree. (human ~0.5d / CC ~1h)

**0.0b Resolve the duplicate working copy (ENG 5A/8A).** The nested `trade-companion/`
folder is a stale clone of the same remote at `dcff384`, 8 commits behind, clean tree,
nothing unpushed — no unique code. Its only unique content was `.env.local` (three Supabase
keys), which is why local dev happened there; the canonical copy had none. DONE during
review: `.env.local` and `.claude/settings.local.json` copied up and verified gitignored
(`.gitignore:4`). REMAINING: user deletes the folder (`rm -rf trade-companion/`).

**0.1 Split and secure `/api/ingest` (Issue 4A + ENG, timing-guarded per XM-ENG6).**
Splitting is mandatory because PasteModal shares the route:
- `/api/plans` (new): authenticated, session-derived `user_id`, RLS-respecting — PasteModal
  calls this.
- `/api/ingest` (kept): machine-only, secret header required, no caller-supplied `user_id`,
  removed from the `publicPaths` bypass.
- **Timing guard:** this edits the LIVE path dad depends on, and the new watchdog does not
  exist yet. Do it on a WEEKEND. Rotate the Zapier secret, then verify the Zap fires
  end-to-end before the next market open. Rollback = revert the deploy.

**0.2 Verify the two unverified gates (XM-ENG6).** Before designing anything that depends
on them: (a) does Gmail filter-forwarding rewrite the envelope sender, or preserve it?
ENG 2A's trust anchor assumes rewriting and has never been checked. (b) Does DKIM
`d=substack.com` survive the forward? Send real test mail through Postmark and read the
Activity payload. **Also define a test-path bypass**, because a test email sent from your
own account fails gate (a) by construction.

**0.3 Extract the eval corpus (XM-ENG6).** Pull historical Mancini emails from the existing
`plans.body` rows in the old Supabase — the only available source of real labeled emails,
and a hard prerequisite for 0.5 that no earlier draft scoped. Target a corpus meaningfully
larger than 15, split into working and held-out sets.

**0.4 Shared LLM helper (ENG 4A).** One `callLLMJson(prompt, validate)` for all three call
sites (TL;DR, classifier, parser), returning a discriminated result —
`{ok:true,data}` or `{ok:false,reason:'timeout'|'malformed'|'refusal'|'no_key'}` — not the
bare `null` that `generate-tldr.ts:105-145` returns today. The retry rule ("retry 2x on
transient, never retry a schema rejection, then fall back to regex") is unimplementable
against `null`. Retry policy lives here, testable without the network.

**0.5 LLM parser + eval suite (XM1).** The de-risking step; this artifact gets ported
already proven. Runner (ENG 7A): a standalone `scripts/eval-parser.mjs` — no test framework
installed into a repo being archived. Loads fixtures, runs the parser, prints per-field
precision/recall, exits non-zero below threshold. Ports by copying one file. Also the home
for Postmark payload fixtures captured in 0.2.

---

## Phase 1 — ship auto-import on the merged old app (XM-ENG3)

The point of this phase: dad gets hands-free plans in **days, not weeks**, and the pipeline
is proven on real mail before MakerKit is involved. Every artifact here ports forward.

1. Postmark server + inbound stream; forward from dad's Gmail to the assigned GUID address
   (`<hash>@inbound.postmarkapp.com`) — no DNS needed yet. Gmail requires adding the address
   as an account-level forwarding destination and entering a confirmation code, which
   arrives readable in Postmark's Activity tab; then the filter (from Mancini → forward).
   Two confirmations, then zero-touch.
2. `/api/inbound` on the old app: Basic auth + Postmark IP allowlist, persist the row,
   return 200 **only after commit**. Postmark retries non-200 ~10 times over ~6 hours; 403
   stops retries instantly — so 500 on genuine failure, 403 only for auth.
3. Sweep, verification, classification, publish gate — all as specified in Phase 2 item 4
   below, built here first.
4. Watchdog via **pg_cron** (`migrate-monitoring.sql` on the merged branch already does
   this) — inside Postgres, DST handled natively, no Vercel plan tier, no shared failure
   domain with the app.
5. Zapier retires once this is stable.

**ENG 9A is REVERSED by XM-ENG1.** Vercel Pro was recommended only because sub-daily cron is
gated there and the failure is silent. pg_cron is already in this repo, is free, has no plan
gating, and removes the shared-Vercel failure domain the plan had accepted as residual risk.
Use pg_cron for both the sweep and the watchdog. Re-evaluate Vercel Pro on its own merits at
Phase 2, not as a scheduling dependency.

---

## Phase 2 — MakerKit re-platform

1. **Scaffold + identity.** `next-supabase-turbo`; fresh Supabase; Vercel project + envs.
   Create dad's user in the new auth and capture the personal `account_id` — input to the
   migration script.
2. **Schema.** Built from the **merged, reconciled** `schema.sql`, never main's stale one.
   `emails` (raw + `status` + `attempts` + content hash), `plans` (versioned), `trades` —
   account-scoped with per-account RLS. `market_holidays` is GLOBAL reference data
   (public-read / admin-write, NOT account-scoped). **Verify first (XM-ENG1/#3):** confirm
   whether a unique index on `plans(user_id, session_date)` actually exists in the live
   database. It is in no committed SQL; either it was applied out-of-band or the ingest
   upsert is erroring. The migration design depends on the answer.
   Remapping user_id-scoped data onto the account model touches every ported query and RLS
   policy — its own step (~0.5d).
3. **Port the product — COMPLETE list (XM-ENG4).** LevelLadder, GamePlan, TradeLog, date
   navigator, PasteModal (permanent manual fallback), **TldrTab.tsx, `/api/tldr`,
   generate-tldr.ts, `/api/es-price`** (all four live for dad today and previously omitted),
   plus the Phase 0 parser and the Phase 1 pipeline. Mobile-responsive pass happens here.
   Also unscoped and flagged: grafting the bespoke dark trading theme (`globals.css`, CSS
   variables, Design Principle #3) onto MakerKit's shadcn/Tailwind defaults — the only part
   of this migration dad actually sees.
4. **Inbound pipeline (re-homed from Phase 1).**
   - *Durability (ENG D1):* no bespoke queue, no lease columns, no reaper, no pgmq. One
     `emails` table with `status` (`pending`/`parsed`/`failed`/`quarantined`) and an
     `attempts` counter. A 5-minute cron sweep runs
     `SELECT ... WHERE status='pending' FOR UPDATE SKIP LOCKED LIMIT 1`. `SKIP LOCKED` is a
     Postgres built-in giving concurrency safety free; a crash rolls back and the next sweep
     retries. Never `after()`/`waitUntil()`. Upgrade path at M2 volume: Supabase Queues
     (pgmq), whose visibility timeout is the lease and whose archive is the dead-letter.
   - *Timeout budget (ENG 10A, corrected by XM-ENG5):* one email triggers up to three
     LLM calls (classify, parse, TL;DR), each potentially 30-60s at
     `reasoning_effort: "high"` — 90-180s worst case, not 30-60s. Therefore: **only classify
     and parse run inside the sweep; TL;DR generation moves to a separate later pass.**
     `LIMIT 1`, explicit `maxDuration`, and an `attempts` cap so a poison row fails loudly
     instead of livelocking.
   - *Idempotency (Issue 5A + XM-ENG5):* dedupe on Postmark's provider `MessageID` (a
     provider-controlled UUID), NOT the forgeable RFC `Message-ID` header. **Plus a content
     hash**, because `MessageID` catches only exact provider redelivery — any re-forward
     (dad re-triggering the filter, a second rule, shadow-mode re-sends) arrives with a new
     `MessageID` and would otherwise create a spurious version and a false "plan updated"
     banner on the one screen dad trusts.
   - *Sender verification (Issue 3A / ENG 2A — gate (a) MUST-VERIFY per XM-ENG6):* the
     original "must pass SPF/DKIM" bar is rejected as unimplementable, since Gmail
     forwarding makes SPF check Gmail rather than Substack. Intended gate: envelope sender
     is dad's Gmail AND original `From` matches Mancini's Substack address; DKIM
     `d=substack.com` auto-approves when present, and its absence downgrades to quarantine
     rather than hard-rejecting. **Gate (a) rests on the unverified assumption that Gmail
     rewrites the envelope sender — Phase 0.2 settles this before the gate is finalized.**
     Everything failing is QUARANTINED to the ingest inbox as "unverified", never parsed,
     never lost, with an audit row.
   - *Classification (Issue 1A):* store all mail, classify server-side (subject/time
     heuristics + LLM tie-break). Only plan-classified mail creates or updates a plan.
     Low-confidence classifications quarantine. **LLM unavailable (ENG 6A): quarantine — do
     not fall through to heuristics alone.** An outage is not a reason to relax 1A.
   - *Same-day updates (Issue 5A):* a genuinely distinct plan-classified email for the same
     `session_date` creates a NEW VERSION; latest is live, prior retained and viewable;
     ladder shows an explicit "plan updated HH:MM" banner.
   - *Source-grounded verification (ENG 11A, corrected by XM-ENG2):* after ANY parse, verify
     deterministically before publishing — (a) every extracted level must be **derivable**
     from the text: verbatim, or via documented shorthand (`6778-82` → 6778 and 6782,
     `6,120` → 6120). The original verbatim-only rule was WRONG: `parser.ts:5-8` documents
     range shorthand, so verbatim matching would reject valid parses and silently constrain
     the LLM to what regex already does. (b) the session date must be found in the text,
     never the invented `fallbackNextTradingDay`. Rule (c) — level count within a band of
     the regex parser's count — is **DROPPED**: regex can return zero, so it would block
     exactly the emails the LLM parser exists to handle. The shorthand expander must mirror
     `parser.ts` exactly and carry its own fixtures.
     REJECTED (ENG 11): a four-agent Claude+ChatGPT ensemble with a governor. The governor
     is itself an unchecked LLM, agent errors correlate because all read the same text, five
     high-reasoning calls breaks the timeout budget, and it reverses commit `5b1d908`'s
     single-vendor decision. Verification does NOT catch omissions — the eval suite (7A) and
     dad's inline corrections (D6.6) cover those.
   - *Parse + publish gate (Issue 2A / XM2):* LLM parse with confidence flags; on hard
     failure after 2 retries, fall back to regex — but publish ONLY if critical fields
     validate. A passing fallback publishes with a "basic parse — LLM unavailable" banner
     and low-confidence flags. A failing one publishes NOTHING. A confidently-wrong ladder
     is worse than a visibly-absent one.
5. **Reliability layer.** Watchdog via pg_cron, trading-day-aware via `market_holidays`.
   Ingest inbox admin page (list, classification, parse status, re-parse, quarantine
   approval, Gmail-verification surfacing). "Plan is ready" notification, firing on ANY
   published plan including fallback-parsed ones, and saying so.
   *Morning states (Issue 9A + ENG 3A + XM-ENG5) — THREE, with a fallback rule:*
   `waiting` (no email yet: latest plan muted with a date badge and expected-arrival note),
   `failed` (arrived and did not publish: say so immediately, offer Paste manually inline,
   alert now rather than at the watchdog's hour), `published`. States derive from the
   `emails` row — **but pasted and migrated plans have no `emails` row**, so the resolver
   falls back to plan-row presence for the current session. Without that, a manual paste
   after a failed auto-parse would still show `failed`.
   *Alert channel (XM-ENG5):* name it explicitly, and route it off a DIFFERENT provider than
   the pipeline — Postmark outbound cannot be the alarm for a Postmark inbound outage.
6. **Migration — bulk + delta (ENG 1A).** Copies history, remapping `user_id` → the new
   `account_id`. TWO passes, because one pre-switch pass loses every trade logged between
   migration and cutover:
   - *Bulk, before shadow:* all history. Acceptance bar runs here with time to fix — row
     counts, content hashes, RLS and foreign keys verified by querying **as dad**, not as
     service role, and the last 10 sessions rendering identically.
   - *Delta, inside the switch window with the old app read-only:* everything changed since.
   - Idempotent and re-runnable. On shadow-written `session_date` collisions, **reconcile
     rather than blind-skip (XM-ENG5/#13)**: a blind skip would discard exactly the manual
     corrections shadow mode exists to surface.
7. **Shadow, then switch (Issue 8B / XM3, criteria added per XM-ENG4).** Weekend HARD
   SWITCH, no 5-session parallel-run burn-in. But first the pipeline runs in SHADOW on real
   weekday mail into the new DB while dad stays on the old app.
   - **Shadow exit criteria (previously undefined):** a stated minimum number of trading
     sessions and a stated agreement rate against the old app's output. XM3 traded a
     measurable gate for an unmeasured one; this restores a number.
   - Ordering is load-bearing: bulk migrate → shadow → delta migrate → switch.
   - DNS TTL lowered ahead of the weekend; tradeladder.io and dad's bookmark flip.
   - **Rollback (reconciled per XM-ENG4/#15):** the old "2 weeks dormant" and the data rule
     contradicted each other, since unreconcilable trade data exists on day 1. Pick ONE and
     state it: either export/re-entry is genuinely automated (currently unscoped work), or
     the honest rollback window is ~24 hours for anything beyond a plan-only revert. The
     Render app still stays dormant, but the window is the constraint, not the uptime.
   - PasteModal works from day one, so a pipeline failure never blocks dad's morning.
   - **Definition of Done:** switch completed + 3 consecutive trading days of clean
     auto-ingest with zero manual intervention.

---

## Eval gate (Issue 7A, sharpened twice)

- **Metric:** per-field precision/recall on critical fields (session date, supports,
  resistances, major/minor tagging), not a single email-level pass rate.
- **Corpus:** extracted in Phase 0.3 from existing `plans.body` rows. Meaningfully more than
  15 emails — the outside voice correctly noted that keeping 15 while splitting off a
  held-out set produces a noisier gate than the one it replaced.
- **Corrections loop:** dad's inline corrections are stored in the DATABASE. Vercel cannot
  append to in-repo fixtures. Curated into fixtures on a stated cadence (XM-ENG6).
- **CI:** runs on every parser/prompt change; blocks on regression against baseline.

## Cost line (XM-ENG4 — previously absent)

State the monthly run rate before committing: Postmark (tier for inbound unconfirmed —
verify), a second Supabase project, `gpt-5.5` at `reasoning_effort: "high"` × up to 3
calls/email/day, and Vercel (Pro no longer required for scheduling per the pg_cron
reversal, so evaluate it on its own merits). Baseline today is Render + Zapier at
roughly zero. M1 is a single-user app; the M2 projection of ~300k messages/month is a
different economic regime.

## Scope decisions (CEO review)

| # | Proposal | Effort (human / CC) | Decision |
|---|----------|---------------------|----------|
| 1 | Delivery watchdog + alerting | S (~0.5d / ~30min) | ACCEPTED |
| 2 | Ingest inbox admin page | S-M (~1d / ~45min) | ACCEPTED |
| 3 | Trading-calendar (CME holidays), global table | S (~2h / ~10min) | ACCEPTED |
| 4 | "Plan is ready" email notification | S (~2h / ~15min) | ACCEPTED (email; PWA deferred) |
| 5 | Mobile-responsive pass | M (~2d / ~1-2h) | ACCEPTED |
| 6 | Parse-confidence flags + inline correction | M (~2d / ~1-2h) | ACCEPTED |
| 7 | Golden-email eval suite as CI gate | M (~1d / ~1h + labeling) | ACCEPTED |
| 8 | Session recap share card | M-L | M2 |
| 9 | Live ES price feed | — | **ALREADY EXISTS** at `src/app/api/es-price/route.ts` — must be PORTED, not built (XM-ENG4 correction) |

## Decision record

| ID | Decision |
|----|----------|
| D3 | Source is Adam Mancini |
| D4→XM1→XM-ENG3 | MakerKit re-platform; parser proven first; auto-import shipped on the merged old app before the port completes |
| D5 | Review mode SELECTIVE EXPANSION |
| D7 / D8 | Vercel; fresh Supabase + migration |
| D9 | Postmark, inbound and outbound |
| 1A / 6A | Store all, classify server-side; LLM unavailable → quarantine |
| 2A / XM2 | LLM failure → regex fallback, publish only if critical fields validate |
| 3A / 2A(eng) | Sender allowlist + trusted-forwarder anchor; gate (a) must be verified in Phase 0.2 |
| 4A | Split `/api/ingest`; weekend-guarded |
| 5A / XM-ENG5 | Dedupe on provider `MessageID` **plus content hash**; same-day update = new version |
| 6B | Concrete Mancini-only parser |
| 7A | Eval suite in M1, per-field precision/recall, corpus from `plans.body` |
| 8B / XM3 | Weekend hard switch, preceded by shadow with stated exit criteria |
| 9A | Pre-arrival morning state |
| ENG D1 | `emails.status` + cron sweep with `FOR UPDATE SKIP LOCKED`; no lease/reaper/pgmq |
| ENG 1A | Migration = bulk + delta, idempotent, reconcile on shadow collisions |
| ENG 3A / XM-ENG5 | Three morning states, with a plan-row fallback for pasted/migrated plans |
| ENG 4A | One `callLLMJson` returning a discriminated result |
| ENG 5A/8A | Duplicate clone resolved; user deletes the folder |
| ENG 7A | Standalone `scripts/eval-parser.mjs`, no framework in the archived repo |
| ENG 9A | **REVERSED by XM-ENG1** — pg_cron already in-repo; Vercel Pro not required for scheduling |
| ENG 10A / XM-ENG5 | Sweep `LIMIT 1` + `maxDuration` + `attempts` cap; TL;DR moved out of the sweep |
| ENG 11A / XM-ENG2 | Range-aware source-grounded verification; regex-count gate dropped; ensemble rejected |
| ENG 12A | Single user (dad) |
| XM-ENG1 | Merge `claude/gallant-faraday-fd559d` first; it is the truthful port source |
| XM-ENG3 | Ship auto-import on the merged old app before the re-platform completes |
| XM-ENG4 | Port list corrected; shadow criteria, rollback window, and cost line added |
| XM-ENG6 | Verify gates before depending on them; extract eval corpus; weekend-guard the live edit |

## Deferred to TODOS

- Triggered second-opinion LLM: escalate to a second provider only when verification fails
  (~1.05 calls/day). Deferred on cost/vendor grounds, not merit
- Cross-provider failover for AVAILABILITY (distinct from ensembling for accuracy)
- External uptime ping on the watchdog
- Sentry error tracking (MakerKit ships the wiring)
- PWA push notifications
- Session recap share card; M2 billing, teams, pitch pack, super-admin
- CME half-days and Mancini vacation days — not holidays, currently unhandled (XM-ENG6)
- Disposition of the second worktree, `romantic-proskuriakova-9f4135`

## NOT in scope

- Scraping Substack behind login (no API; ToS-hostile; email is the channel)
- Keeping Zapier past Phase 1
- Source-adapter/pluggable parser abstraction (Issue 6B)
- Multi-agent ensemble + governor (ENG 11 — verification dominates it here)
- 5-session parallel-run burn-in (shadow mode covers the validation gap)
- Multi-user support in M1 (ENG 12A)
- Redistributing Mancini's content to other users — a licensing question owned by the
  M2/pitch track

## Reviewer concerns (open)

- **Effort estimate is unvalidated.** Two outside voices called it fiction, and the port
  list just grew by two components and two routes. Re-baseline after Phase 0 and again
  after Phase 1 — those are the first honest data points. No number here should be trusted
  until then.
- **Gmail forwarding behavior is unverified** and two gates depend on it (Phase 0.2).
- **The `plans(user_id, session_date)` unique constraint is unconfirmed** in the live
  database (Phase 2 item 2).
- **Postmark inbound tier is unconfirmed.**
- **The dark-theme graft onto MakerKit's shadcn/Tailwind defaults is unscoped and has had
  no design review** — it is the most user-visible part of the migration.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | SELECTIVE EXPANSION: 9 proposals, 7 accepted, 7 deferred; 12 decisions |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 12 findings; 2 factual corrections to the review itself; 3 tensions resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 12 issues across 4 sections, all resolved; scope gate triggered and answered |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CODEX:** The CEO-stage codex pass disproved two review assumptions by reading the repo (no
LLM parser exists; `/api/ingest` is unauthenticated and shared with PasteModal). The
eng-stage codex pass timed out after 5 minutes on a 34KB plan; a Claude subagent ran instead
and returned 23 findings, 7 of which were verified against files.

**CROSS-MODEL:** Seven tensions surfaced across both stages and all seven were resolved by
the user. The eng-stage outside voice found what both reviews missed: an unmerged
12-commit branch holding the only accurate schema, a stale `schema.sql` feeding the port, a
pg_cron implementation already in-repo that removes a paid-plan dependency, and two broken
verification rules this review itself had recommended. Cross-model review changed the plan's
phasing, its port source, and its scheduling stack.

**VERDICT:** CEO + ENG CLEARED — ready to implement, starting with the Phase 0.0 merge.

**UNRESOLVED DECISIONS:**
- Effort estimates remain unvalidated; re-baseline after Phase 0 and Phase 1.
- Gmail envelope-sender rewriting and DKIM survival unverified (blocks finalizing ENG 2A gate (a)).
- Existence of the `plans(user_id, session_date)` unique constraint in the live database unconfirmed.
- Postmark inbound plan tier unconfirmed.
- Dark-theme graft onto MakerKit defaults unscoped and unreviewed by design review.
- Disposition of the second worktree `romantic-proskuriakova-9f4135` undecided.

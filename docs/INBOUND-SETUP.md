# Inbound pipeline setup

Everything in this runbook needs an account, a credential, or a real email — the
parts an agent cannot do for you. The code is written, typechecked, built, and
tested; this is the wiring.

Work top to bottom. Each step says how to tell it worked.

---

## 0. Apply the migrations

Supabase dashboard → SQL Editor. Run in this order:

1. `migrate-plans-unique.sql`
2. `migrate-inbound-pipeline.sql`
3. `migrate-inbound-pipeline-fns.sql`

### Step 1 is not routine — read this

`/api/ingest` has always upserted with `onConflict: "user_id,session_date"`, but
**no committed SQL has ever created a unique index on those columns.** Postgres
requires one for `ON CONFLICT`. So exactly one of these is true right now:

- the index was added by hand in the dashboard and is simply undocumented, or
- **every ingest upsert has been failing** with `42P10`.

Find out before assuming. In the SQL editor:

```sql
select indexname from pg_indexes
 where tablename = 'plans' and indexdef ilike '%user_id%session_date%';

select count(*), max(created_at) from plans;
```

If the first query returns nothing and the second shows no recent rows despite
daily emails, ingest has been broken and this migration is the fix. Either way
the migration is idempotent and leaves the database correct. It aborts with a
clear message if duplicate `(user_id, session_date)` rows exist — reconcile
those first, keeping the newest per pair.

### Extensions

`migrate-inbound-pipeline-fns.sql` needs two extensions, one click each in
Database → Extensions: **pg_cron** and **pg_net**.

Then set the two database settings the cron jobs read:

```sql
alter database postgres set app.settings.app_url     = 'https://tradeladder.io';
alter database postgres set app.settings.cron_secret = '<the CRON_SECRET below>';
```

Verify: `select jobname, schedule, active from cron.job;` → two rows,
`tradeladder-sweep` and `tradeladder-watchdog`.

---

## 1. Postmark

1. Create a Postmark account. **Confirm inbound is available on the plan you
   pick** — this is unverified and some tiers gate it. Volume here is roughly
   120 messages/month across both directions, so the cheapest qualifying tier
   is the target.
2. Create a **Server** named something like `TradeLadder Ingest`. Its inbound
   stream already exists — you cannot add a second one to a server, and you do
   not need to.
3. Open the inbound stream → Setup Instructions. Copy the GUID address, which
   looks like `<hash>@inbound.postmarkapp.com`.

Skip MX and DNS for now. The GUID address works immediately, and moving to
`inbound.tradeladder.io` later requires no code change.

---

## 2. Environment variables

Generate the webhook credential:

```bash
printf 'tradeladder:%s' "$(openssl rand -hex 24)" | base64
```

Add to `.env.local` and to the deployment environment:

```
INBOUND_WEBHOOK_BASIC=<the base64 string from above>
CRON_SECRET=<openssl rand -hex 32>
```

`INBOUND_TEST_MODE=1` is for step 4 only. It accepts mail on a From-header
match alone so you can test before a Gmail forwarding rule exists. **Never set
it in production** — it reduces the trust anchor to a forgeable header.

---

## 3. Point Postmark at the app

The webhook must be reachable from the internet, so `localhost` will not do.
Either deploy, or run `npx ngrok http 3000` for a temporary public URL.

Postmark → your server → inbound stream → Settings → Webhook:

```
https://tradeladder:<password>@your-app.com/api/inbound
```

Postmark turns those credentials into the `Authorization: Basic` header the
route checks. The credential goes in the header, never in the path — paths leak
into logs and referrers.

---

## 4. Create the route row and send a test email

The webhook has no session, so a routing row decides which account a message
belongs to. Get your user id from Supabase → Authentication → Users:

```sql
insert into inbound_routes (recipient, user_id, allowed_forwarder, allowed_from, active)
values (
  '<hash>@inbound.postmarkapp.com',
  '<dad-user-uuid>',
  'dad@gmail.com',                    -- the ONLY mailbox that forwards here
  'adam@mancini.substack.com',        -- the newsletter's real sending address
  true
);
```

Both addresses must be exact. Find the real `allowed_from` by opening one of
Mancini's emails and reading the actual sender, not the display name.

Now set `INBOUND_TEST_MODE=1`, forward a real Mancini email to the GUID
address, and check:

- Postmark Activity shows the message and the webhook returning **200**
- `select id, status, from_email, envelope_sender from emails order by received_at desc limit 5;`

**While you are in the Activity payload, answer the two open questions.** Both
gate the sender-verification design and neither has been checked:

1. **Does Gmail forwarding rewrite the envelope sender?** Compare the `From`
   field Postmark reports against the original sender. If Gmail preserves the
   original rather than substituting the forwarding account, the trust anchor
   in `src/lib/verify-sender.ts` needs rethinking and `allowed_forwarder` must
   change accordingly.
2. **Does DKIM survive?** Look for a `DKIM-Signature` header with
   `d=` the newsletter's domain. If it survives, it auto-approves and provenance
   is much stronger than the forwarder check alone.

Record what you find in `docs/designs/MAKERKIT-REPLATFORM.md` under Reviewer
Concerns, then turn `INBOUND_TEST_MODE` off.

---

## 5. Watch it parse

Within five minutes the sweep should claim the row. Force it immediately with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.com/api/cron/sweep
```

Then open **`/admin/emails`** (needs your uuid in `ADMIN_USER_IDS`). Each row
shows the pipeline's decision and its reason, and that reason is the diagnosis:

| Status | Meaning | What to do |
|---|---|---|
| `parsed` | plan published | nothing |
| `pending` | waiting for the sweep, or retrying | wait one cycle |
| `quarantined` | sender or classifier was not satisfied | read the reason; approve if it is genuinely the plan |
| `inert` | classified as not-a-plan (recap, update) | nothing — correct behavior |
| `failed` | parsed but did not clear the publish gate | read the reason; re-parse after fixing |

---

## 6. Turn on real forwarding

Gmail needs the destination verified before a filter can target it. Two steps:

1. Gmail → Settings → Forwarding and POP/IMAP → **Add a forwarding address** →
   paste the Postmark GUID address. Gmail sends a confirmation code there.
2. The code arrives **in `/admin/emails`** like any other message. Read it,
   enter it in Gmail.
3. Create the filter: `from:(adam@mancini.substack.com)` → Forward to that
   address. Match the real sending address exactly.

After this it is hands-free. Retire the Zapier integration.

---

## 7. Deploy note — read before deploying the merge

The merged `F2` commit made `/api/ingest` **authenticated** and removed it from
`publicPaths`. Production is still running the older unauthenticated version,
so **deploying the merge will break Zapier**, which posts without a session.

Sequence it deliberately:

- ship the merge and the Postmark pipeline together, so `/api/inbound` replaces
  Zapier in the same deploy, **or**
- accept a gap where manual paste is the only path, and tell the user.

Manual paste keeps working throughout either way — it always does, which is why
`PasteModal` never gets removed.

Do this on a **weekend**. Editing the live ingest path on a trading morning,
before the watchdog and the failed-state banner exist to report problems, is
how a Tuesday gets ruined.

---

## What is still open

| Item | Where it is settled |
|---|---|
| Gmail envelope-sender rewriting | step 4 |
| DKIM survival through forwarding | step 4 |
| Whether the `plans` unique index already existed | step 0 |
| Postmark inbound plan tier | step 1 |
| Eval corpus | export `plans.body` rows into `evals/fixtures/`, then `npm run eval` |

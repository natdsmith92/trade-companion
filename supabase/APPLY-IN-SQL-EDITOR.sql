-- TradeLadder — all three inbound-pipeline migrations, in dependency order.
-- Paste this whole file into the Supabase SQL Editor and run it once.
--
-- Safe to re-run: every statement is idempotent (if not exists / create or
-- replace / on conflict do nothing), and the unique-index step aborts with a
-- clear message rather than forcing anything if duplicate rows exist.
--
-- Generated from supabase/migrations/ — edit those, not this.

-- ══════════════════════════════════════════════════════════════════
-- 20260830000001_plans_unique_index.sql
-- ══════════════════════════════════════════════════════════════════
-- TradeLadder — Migration: the unique index /api/ingest has always assumed
--
-- WHY THIS EXISTS
-- src/app/api/ingest/route.ts upserts with:
--     .upsert({...}, { onConflict: "user_id,session_date" })
-- Postgres requires a UNIQUE index on exactly (user_id, session_date) to
-- satisfy ON CONFLICT. No committed SQL has ever created one — not schema.sql,
-- not migrate-multi-tenant.sql (which creates only a NON-unique idx_plans_user_id),
-- and not the reconciled schema from F5. The only unique index in the whole
-- database is trades_user_idempotency_idx.
--
-- So exactly one of these is true in production right now:
--   (a) the index was added by hand in the Supabase dashboard and is therefore
--       undocumented — this migration makes it explicit and idempotent, or
--   (b) it was never added, and EVERY ingest upsert has been failing with
--       42P10 "no unique or exclusion constraint matching the ON CONFLICT
--       specification".
--
-- Run the verification block at the bottom to find out which. Either way this
-- migration leaves the database in the documented, correct state.
--
-- The versioned-plans design (decision 5A) will later replace this with a
-- unique index on (user_id, session_date, version). Until then, one plan per
-- user per session is the invariant the application code already assumes.

-- ───── Pre-flight: surface duplicates before the index rejects them ─────
-- If this returns rows, the unique index cannot be created until they are
-- reconciled. Newest row per (user_id, session_date) is normally the keeper.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select user_id, session_date
    from plans
    where user_id is not null
    group by user_id, session_date
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'Cannot create unique index: % (user_id, session_date) pairs have duplicate rows. Reconcile them first (keep the newest created_at per pair).',
      dup_count;
  end if;
end $$;

-- ───── The index ─────
-- Partial: rows with a null user_id are legacy pre-multi-tenant data and are
-- excluded rather than blocking the migration.
create unique index if not exists plans_user_session_idx
  on plans (user_id, session_date)
  where user_id is not null;

-- ───── Verification ─────
-- Confirms the index now exists. Run this after applying:
--
--   select indexname, indexdef
--   from pg_indexes
--   where tablename = 'plans' and indexname = 'plans_user_session_idx';
--
-- To learn whether case (a) or (b) above was true, check whether ingest was
-- erroring before this ran:
--
--   select count(*) from plans where created_at > now() - interval '30 days';
--
-- A count of zero alongside a user who receives daily emails is strong
-- evidence of case (b).

-- ══════════════════════════════════════════════════════════════════
-- 20260830000002_inbound_pipeline.sql
-- ══════════════════════════════════════════════════════════════════
-- TradeLadder — Migration: inbound email pipeline (Phase 1)
--
-- Adds the `emails` table: the durable record of every message Postmark
-- delivers, and the work queue the sweep drains.
--
-- DESIGN (eng-review decision ENG D1)
-- No bespoke queue, no lease columns, no reaper, no pgmq. One table with a
-- status column, drained by a cron sweep using Postgres' own FOR UPDATE
-- SKIP LOCKED. A worker crash rolls the transaction back and the next sweep
-- retries the row. At 1-3 emails/day a real queue is accidental complexity;
-- the upgrade path at multi-user volume is Supabase Queues (pgmq), whose
-- visibility timeout is the lease and whose archive is the dead-letter.
--
--   POSTMARK ──▶ /api/inbound ──▶ INSERT (status='pending') ──▶ 200
--                                        │
--            cron sweep (every 5 min) ───┤ SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1
--                                        ▼
--                   verify sender ──▶ classify ──▶ parse ──▶ verify levels
--                        │               │           │            │
--                   quarantined      quarantined   failed      published
--                                    (non-plan
--                                     = inert)
--
-- STATUS VALUES
--   pending     — received, not yet processed
--   parsed      — produced a plan row
--   inert       — classified as non-plan (recap, intraday note); kept, never parsed
--   quarantined — failed sender verification OR low-confidence classification
--                 OR classifier LLM unavailable. Visible, one-tap approvable.
--   failed      — classified as a plan but parsing/verification did not clear
--                 the publish gate. Alert + re-parse from the ingest inbox.

create table if not exists emails (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),

  -- Postmark's own provider-controlled UUID. Dedupe key for exact redelivery.
  -- NOT the RFC Message-ID header, which is caller-controlled and forgeable.
  postmark_message_id text,

  -- SHA-256 of the normalized body. Catches the duplicate case MessageID
  -- cannot: a re-forward (dad re-triggering the filter, a second forwarding
  -- rule, a shadow-mode re-send) arrives with a FRESH postmark_message_id and
  -- would otherwise create a spurious plan version and a false
  -- "plan updated HH:MM" banner on the one screen he trusts.
  content_hash text,

  -- Envelope + header identity, retained for the audit trail on every
  -- accept/quarantine decision.
  from_email text,
  envelope_sender text,
  subject text,
  body text not null,
  received_at timestamptz default now(),

  status text not null default 'pending'
    check (status in ('pending','parsed','inert','quarantined','failed')),

  -- Why a row landed in quarantined/failed. Rendered in the ingest inbox.
  status_reason text,

  -- Retry accounting. The sweep gives up at max_attempts and marks the row
  -- failed rather than livelocking on a poison message.
  attempts integer not null default 0,
  last_attempt_at timestamptz,

  -- Set once the row produces a plan.
  plan_id uuid references plans(id) on delete set null,

  created_at timestamptz default now()
);

-- Dedupe: exact provider redelivery is a no-op.
create unique index if not exists emails_postmark_message_id_idx
  on emails (postmark_message_id)
  where postmark_message_id is not null;

-- Dedupe: re-forwards of identical content for the same user.
create unique index if not exists emails_user_content_hash_idx
  on emails (user_id, content_hash)
  where content_hash is not null;

-- The sweep's access path: pending rows, oldest first.
create index if not exists emails_pending_idx
  on emails (status, received_at)
  where status = 'pending';

-- Ingest-inbox listing.
create index if not exists emails_user_received_idx
  on emails (user_id, received_at desc);

-- ───── Row Level Security ─────
alter table emails enable row level security;

drop policy if exists "Users read own emails" on emails;
create policy "Users read own emails" on emails
  for select using (auth.uid() = user_id);

drop policy if exists "Users update own emails" on emails;
create policy "Users update own emails" on emails
  for update using (auth.uid() = user_id);

-- Inserts come from the webhook via the service-role client, which bypasses
-- RLS. There is deliberately no INSERT policy for end users: a public webhook
-- has no session, so row ownership is decided by the routing map, not by a
-- caller-supplied id.

-- ───── Inbound routing map ─────
-- A public webhook has no session, so the recipient address is the authority
-- for which account a message belongs to. One row today (dad). Postmark's
-- MailboxHash (whatever follows "+" in the recipient) is the scaling
-- mechanism when this becomes multi-user — no redesign required.
create table if not exists inbound_routes (
  id uuid default gen_random_uuid() primary key,
  -- Match on MailboxHash when present, else the full recipient address.
  mailbox_hash text,
  recipient text,
  user_id uuid not null references auth.users(id),
  -- Envelope sender permitted to forward to this route (the trust anchor:
  -- the only mailbox whose filter targets this address).
  allowed_forwarder text,
  -- Original From that must appear inside the forwarded message.
  allowed_from text,
  active boolean not null default true,
  created_at timestamptz default now()
);

create unique index if not exists inbound_routes_hash_idx
  on inbound_routes (mailbox_hash) where mailbox_hash is not null;
create unique index if not exists inbound_routes_recipient_idx
  on inbound_routes (recipient) where recipient is not null;

alter table inbound_routes enable row level security;
drop policy if exists "Users read own routes" on inbound_routes;
create policy "Users read own routes" on inbound_routes
  for select using (auth.uid() = user_id);

-- ───── Market holidays: GLOBAL reference data ─────
-- Deliberately NOT account-scoped. The CME calendar is identical for every
-- account, so per-account RLS would be an architectural mismatch. Public
-- read, service-role write.
create table if not exists market_holidays (
  holiday_date date primary key,
  name text not null,
  -- Half-days are real and are NOT full holidays: the market opens, so a
  -- missing plan is still a genuine alert, but the schedule differs.
  early_close boolean not null default false
);

alter table market_holidays enable row level security;
drop policy if exists "Anyone can read holidays" on market_holidays;
create policy "Anyone can read holidays" on market_holidays
  for select using (true);

-- CME equity-index holidays. REFRESH EVERY JANUARY (owner: repo maintainer).
-- A stale table produces false watchdog alarms on every holiday, which is
-- alarm fatigue on the one channel that has to stay trustworthy.
insert into market_holidays (holiday_date, name, early_close) values
  ('2026-01-01','New Year''s Day',false),
  ('2026-01-19','Martin Luther King Jr. Day',false),
  ('2026-02-16','Presidents Day',false),
  ('2026-04-03','Good Friday',false),
  ('2026-05-25','Memorial Day',false),
  ('2026-06-19','Juneteenth',false),
  ('2026-07-03','Independence Day (observed)',false),
  ('2026-09-07','Labor Day',false),
  ('2026-11-26','Thanksgiving',false),
  ('2026-11-27','Day after Thanksgiving',true),
  ('2026-12-24','Christmas Eve',true),
  ('2026-12-25','Christmas Day',false)
on conflict (holiday_date) do nothing;

-- ══════════════════════════════════════════════════════════════════
-- 20260830000003_inbound_pipeline_fns.sql
-- ══════════════════════════════════════════════════════════════════
-- TradeLadder — Migration: sweep claim function + pg_cron schedules
--
-- Depends on migrate-inbound-pipeline.sql (emails, inbound_routes, market_holidays).
--
-- WHY pg_cron AND NOT VERCEL CRON
-- The eng review originally called for Vercel Pro, because sub-daily cron is a
-- paid feature there and the failure mode is silent (emails simply sit
-- unprocessed). Then the outside voice pointed out this repo already schedules
-- work with pg_cron in migrate-monitoring.sql. pg_cron is free, has no plan
-- tier, handles timezones through Postgres itself, and — the part that matters
-- — does not share a failure domain with the app it is monitoring. A Vercel
-- outage would otherwise take down both the pipeline and the watchdog meant to
-- report on it.
--
-- PREREQUISITES (one click each in the Supabase dashboard, Database → Extensions)
--   pg_cron  — the scheduler
--   pg_net   — lets a scheduled job make an HTTP call into the app

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───── Atomic claim ─────
-- SELECT ... FOR UPDATE SKIP LOCKED is the entire concurrency design. Two
-- overlapping sweeps never claim the same row, and a crash mid-processing
-- rolls back to 'pending' with no lease to expire and no reaper to write.
--
-- The attempts bump happens inside the same statement as the claim, so a row
-- that repeatedly kills the worker still counts its attempts and eventually
-- stops being claimed. Without that, a poison message livelocks the sweep
-- forever while paying for every killed LLM call.
create or replace function claim_pending_email(max_attempts integer default 3)
returns table (
  id uuid,
  user_id uuid,
  subject text,
  body text,
  from_email text,
  envelope_sender text,
  attempts integer
)
language plpgsql
as $$
begin
  -- Distinct aliases (cand / tgt) on purpose. Using `e` for both the CTE
  -- source and the UPDATE target is legal but reads as if one shadows the
  -- other, and this is the function everything else depends on being correct.
  return query
  with candidate as (
    select cand.id
    from emails cand
    where cand.status = 'pending'
      and cand.attempts < claim_pending_email.max_attempts
    order by cand.received_at asc
    for update skip locked
    limit 1
  )
  update emails tgt
     set attempts = tgt.attempts + 1,
         last_attempt_at = now()
    from candidate c
   where tgt.id = c.id
  -- attempts is returned POST-increment, so the caller sees the attempt it is
  -- about to make counted. The sweep compares it against MAX_ATTEMPTS to
  -- decide whether this is the last try before giving up.
  returning tgt.id, tgt.user_id, tgt.subject, tgt.body,
            tgt.from_email, tgt.envelope_sender, tgt.attempts;
end;
$$;

-- ───── Trading-day helper ─────
-- Weekend and holiday aware. Half-days are still trading days: the market
-- opens, so a missing plan on a half-day is a real alert.
create or replace function is_trading_day(d date default (now() at time zone 'America/New_York')::date)
returns boolean
language sql
stable
as $$
  select extract(isodow from d) < 6
     and not exists (
       select 1 from market_holidays h
        where h.holiday_date = d and h.early_close = false
     );
$$;

-- ───── Watchdog ─────
-- Answers one question: it is a trading morning and no plan has been
-- published — is anything broken?
--
-- Runs HOURLY and checks the local wall clock rather than being scheduled at a
-- fixed UTC hour. pg_cron schedules are UTC-only, so a fixed hour drifts by an
-- hour twice a year across DST. Postgres' AT TIME ZONE knows about DST, so
-- asking "is it 8am in New York right now?" is correct year round. The
-- alternative — two seasonal cron expressions — needs a human to remember to
-- edit them, twice a year, forever.
create or replace function check_plan_arrived()
returns void
language plpgsql
as $$
declare
  ny_now timestamptz := now() at time zone 'America/New_York';
  today date := (now() at time zone 'America/New_York')::date;
  plan_count integer;
  stuck_count integer;
begin
  -- Only fire in the 8am hour, on trading days.
  if extract(hour from ny_now) <> 8 then return; end if;
  if not is_trading_day(today) then return; end if;

  select count(*) into plan_count from plans where session_date = today;

  -- Emails that arrived but never made it out of the pipeline are a distinct
  -- and more urgent signal than nothing arriving at all: it means delivery
  -- worked and processing did not.
  select count(*) into stuck_count
    from emails
   where status in ('pending','failed','quarantined')
     and received_at > (today - interval '1 day');

  if plan_count = 0 then
    raise warning
      '[watchdog] no plan for trading day % as of 8am ET. % inbound email(s) stuck in pending/failed/quarantined.',
      today, stuck_count;
    insert into watchdog_alerts (alert_date, kind, detail)
    values (
      today,
      case when stuck_count > 0 then 'stuck_pipeline' else 'no_delivery' end,
      format('no plan for %s; %s email(s) unprocessed', today, stuck_count)
    )
    on conflict (alert_date, kind) do nothing;
  end if;
end;
$$;

-- Alert ledger. Also the record the app reads to decide whether to show the
-- "not arrived" morning state, so the UI and the alerting agree by
-- construction rather than by two separate implementations of the same rule.
create table if not exists watchdog_alerts (
  id uuid default gen_random_uuid() primary key,
  alert_date date not null,
  kind text not null check (kind in ('no_delivery','stuck_pipeline')),
  detail text,
  acknowledged boolean not null default false,
  created_at timestamptz default now()
);
create unique index if not exists watchdog_alerts_date_kind_idx
  on watchdog_alerts (alert_date, kind);

alter table watchdog_alerts enable row level security;
drop policy if exists "Anyone can read alerts" on watchdog_alerts;
create policy "Anyone can read alerts" on watchdog_alerts for select using (true);

-- ───── Schedules ─────
-- cron.schedule is idempotent on job name: re-running this migration replaces
-- the schedule rather than stacking duplicates.
--
-- The sweep calls back into the app because parsing needs the OpenAI client,
-- which lives there. Set app.settings.* once per database:
--
--   alter database postgres set app.settings.app_url    = 'https://tradeladder.io';
--   alter database postgres set app.settings.cron_secret = '<same as CRON_SECRET>';

select cron.schedule(
  'tradeladder-sweep',
  '*/5 * * * *',
  $$
  select net.http_get(
    url     := current_setting('app.settings.app_url') || '/api/cron/sweep',
    headers := jsonb_build_object(
                 'Authorization',
                 'Bearer ' || current_setting('app.settings.cron_secret')
               ),
    timeout_milliseconds := 290000
  );
  $$
);

select cron.schedule(
  'tradeladder-watchdog',
  '0 * * * *',          -- hourly; the function decides if it is 8am in New York
  $$ select check_plan_arrived(); $$
);

-- ───── Verification ─────
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select claim_pending_email();          -- claims one row, for manual testing
--   select is_trading_day('2026-12-25');   -- false


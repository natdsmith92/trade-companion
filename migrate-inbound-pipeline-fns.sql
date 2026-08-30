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
  return query
  with claimed as (
    select e.id
    from emails e
    where e.status = 'pending'
      and e.attempts < max_attempts
    order by e.received_at asc
    for update skip locked
    limit 1
  )
  update emails e
     set attempts = e.attempts + 1,
         last_attempt_at = now()
    from claimed c
   where e.id = c.id
  returning e.id, e.user_id, e.subject, e.body, e.from_email, e.envelope_sender, e.attempts;
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

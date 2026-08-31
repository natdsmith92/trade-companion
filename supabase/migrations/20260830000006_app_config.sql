-- TradeLadder — Migration: config table for the cron jobs
--
-- The jobs originally read app_url and cron_secret from database-level
-- settings via current_setting('app.settings.*'). That cannot be made to work
-- here: `alter database postgres set ...` is permission-denied over the
-- connection pooler, so the settings never existed and every scheduled run
-- failed with:
--
--   ERROR: unrecognized configuration parameter "app.settings.app_url"
--
-- Silently, of course — a failed cron run writes to cron.job_run_details and
-- nowhere a person would look.
--
-- A table instead. It is also better than inlining the secret in the job
-- command, which would put it in cron.job.command in clear text, and it can be
-- updated without recreating the schedule.

create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- RLS on with NO policies: denies every normal client outright. pg_cron runs
-- as the table owner and the service role bypasses RLS, so both still read it.
alter table app_config enable row level security;

comment on table app_config is
  'Server-side config for pg_cron jobs. RLS denies all client access by design.';

-- Rebuild both schedules to read from the table. cron.schedule is idempotent
-- on job name, so this replaces rather than duplicates.
select cron.schedule(
  'tradeladder-sweep',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select value from app_config where key = 'app_url') || '/api/cron/sweep',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select value from app_config where key = 'cron_secret')
    ),
    timeout_milliseconds := 290000
  );
  $$
);

-- The watchdog is pure SQL and never needed the HTTP settings; rescheduled
-- only to keep both definitions in one place.
select cron.schedule(
  'tradeladder-watchdog',
  '0 * * * *',
  $$ select check_plan_arrived(); $$
);

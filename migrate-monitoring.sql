-- ══════════════════════════════════════════════
-- TradeLadder — Migration: Monitoring + pg_cron parse-success check (F8b)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════
-- Two pieces:
--
-- 1. monitoring_alerts table — append-only log of operational alerts.
--    Today only check_daily_parse_success() writes to it.
--
-- 2. check_daily_parse_success() function + pg_cron schedule (Mon-Fri 14:00 UTC,
--    which is ~9am ET, after Mancini's morning send window).
--
-- PREREQUISITE: enable pg_cron extension in Supabase Dashboard
-- (Database → Extensions → pg_cron → Enable). It is one click.
-- After this migration runs, alerts are queryable via:
--   SELECT * FROM monitoring_alerts WHERE created_at > now() - interval '7 days';
--
-- F8a (UptimeRobot, external) catches Render outages. This (F8b) catches
-- "parser ran but produced no plan" — a Render-up + data-missing failure
-- mode that pg_cron sees natively because it lives inside Postgres.

-- ───── alerts table ─────
create table if not exists monitoring_alerts (
  id uuid default gen_random_uuid() primary key,
  kind text not null,
  detail text,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  created_at timestamptz default now()
);

create index if not exists idx_monitoring_alerts_created_at on monitoring_alerts (created_at desc);
create index if not exists idx_monitoring_alerts_kind on monitoring_alerts (kind);

-- RLS: service-role only. Internal monitoring is not user-facing.
alter table monitoring_alerts enable row level security;

-- ───── parse-success check function ─────
-- Verifies that at least one plan was ingested for today's session_date.
-- For the dad-stage single-user product, "any plan exists" is the right
-- bar; once N>1 users, this should iterate per user and check coverage.
create or replace function check_daily_parse_success()
returns void
language plpgsql
security definer
as $$
declare
  today_date date := current_date;
  plan_count integer;
begin
  select count(*) into plan_count
  from plans
  where session_date = today_date;

  if plan_count = 0 then
    insert into monitoring_alerts (kind, detail, severity)
    values (
      'parse_missing',
      'No plan ingested for ' || today_date::text || ' by 14:00 UTC',
      'high'
    );
  end if;
end;
$$;

-- ───── pg_cron schedule ─────
-- Mon-Fri at 14:00 UTC = 09:00 ET (during DST, when ES futures open).
-- Mancini sends his email pre-market, so by 9am ET dad's plan should
-- already be in the database. If it's not, alert.
--
-- Idempotent: cron.schedule with the same job name overwrites the prior
-- entry rather than failing.
select cron.schedule(
  'daily-parse-check',
  '0 14 * * 1-5',
  $$ select check_daily_parse_success(); $$
);

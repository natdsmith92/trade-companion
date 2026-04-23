-- ══════════════════════════════════════════════
-- TradeLadder — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════

-- Plans table: stores each daily Mancini email
create table if not exists plans (
  id uuid default gen_random_uuid() primary key,
  session_date date not null,
  email_date text not null,
  subject text not null,
  body text not null,
  created_at timestamptz default now()
);

-- Trades table: stores trade log entries
create table if not exists trades (
  id uuid default gen_random_uuid() primary key,
  session_date date not null,
  symbol text not null default 'ES',
  direction text not null check (direction in ('long', 'short')),
  contracts integer not null default 1,
  entry_price numeric not null,
  exit_75_price numeric,
  exit_runner_price numeric,
  setup_type text check (setup_type in ('Failed Breakdown', 'Flag', 'Trendline', 'Other')),
  point_value numeric not null default 50,
  notes text,
  pnl numeric,
  created_at timestamptz default now()
);

create index if not exists idx_plans_session_date on plans (session_date desc);
create index if not exists idx_plans_created_at on plans (created_at desc);
create index if not exists idx_trades_session_date on trades (session_date desc);
create index if not exists idx_trades_created_at on trades (created_at desc);

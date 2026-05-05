-- ══════════════════════════════════════════════
-- TradeLadder — Supabase Schema (canonical, current state)
-- Run this on a fresh Supabase project. For an existing project,
-- run the migrate-*.sql files in chronological order instead.
-- ══════════════════════════════════════════════
-- Tables: plans, trades
-- Migrations folded in here:
--   • migrate-session-date.sql      — session_date column on both tables
--   • migrate-multi-tenant.sql      — user_id + RLS policies
--   • migrate-trade-idempotency.sql — F10 idempotency_key on trades
-- TLDR JSONB column on plans is also included (was added directly via
-- the dashboard; folded in here so a fresh deploy includes it).

-- ───── plans ─────
-- One row per daily Mancini email per user.
create table if not exists plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  session_date date not null,
  email_date text not null,
  subject text not null,
  body text not null,
  -- AI-generated headline + structured TL;DR (TldrData shape).
  -- Written by /api/tldr, read by TldrTab.
  tldr jsonb,
  created_at timestamptz default now()
);

-- ───── trades ─────
-- One row per logged trade. idempotency_key dedupes double-submits.
create table if not exists trades (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
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
  -- F10: client-supplied UUID for double-submit dedup at the (user_id, key) pair.
  -- Nullable so legacy rows and admin inserts stay valid.
  idempotency_key text,
  created_at timestamptz default now()
);

-- ───── indexes ─────
create index if not exists idx_plans_user_id on plans (user_id);
create index if not exists idx_plans_session_date on plans (session_date desc);
create index if not exists idx_plans_created_at on plans (created_at desc);
create index if not exists idx_trades_user_id on trades (user_id);
create index if not exists idx_trades_session_date on trades (session_date desc);
create index if not exists idx_trades_created_at on trades (created_at desc);

-- F10: only one trade per user can hold a given idempotency_key.
create unique index if not exists trades_user_idempotency_idx
  on trades (user_id, idempotency_key)
  where idempotency_key is not null;

-- ───── row level security ─────
alter table plans enable row level security;
alter table trades enable row level security;

create policy "Users can view their own plans"
  on plans for select
  using (auth.uid() = user_id);

create policy "Users can insert their own plans"
  on plans for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own plans"
  on plans for delete
  using (auth.uid() = user_id);

create policy "Users can view their own trades"
  on trades for select
  using (auth.uid() = user_id);

create policy "Users can insert their own trades"
  on trades for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own trades"
  on trades for update
  using (auth.uid() = user_id);

create policy "Users can delete their own trades"
  on trades for delete
  using (auth.uid() = user_id);

-- The service role key bypasses RLS entirely, so the webhook ingest path
-- (/api/inbound-email once Phase 4 lands, /api/ingest today) keeps working.

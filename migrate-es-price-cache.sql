-- ══════════════════════════════════════════════
-- TradeLadder — Migration: Persistent ES Price Cache (F6)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════
-- Replaces the module-level in-memory cache in /api/es-price with a
-- single-row table. Survives Render cold starts and shares state
-- across horizontally-scaled instances. Also gives F8b's pg_cron a
-- place to write a pre-warmed quote so the UI keeps a recent
-- fallback frame even if Yahoo bans the IP.

create table if not exists es_price_cache (
  id integer primary key default 1,
  price numeric not null default 0,
  change numeric not null default 0,
  change_percent numeric not null default 0,
  market_state text not null default 'CLOSED',
  updated_at timestamptz not null default now(),
  -- Singleton: this table holds exactly one row.
  constraint es_price_cache_singleton check (id = 1)
);

-- RLS on, no policies. Only the service-role key writes/reads here.
alter table es_price_cache enable row level security;

-- Seed the singleton row so subsequent updates hit something.
insert into es_price_cache (id) values (1)
  on conflict (id) do nothing;

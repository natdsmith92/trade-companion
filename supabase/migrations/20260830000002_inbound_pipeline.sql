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

-- TradeLadder — Migration: retain inbound headers
--
-- /api/inbound stored sender, subject and body but dropped Headers. The sweep
-- runs later and re-verifies the sender, and DKIM lives only in the headers —
-- so by the time it looked, the evidence was gone and every genuine forward
-- quarantined with "no DKIM signature ... (found none)".
--
-- Caught end to end against real mail. Unit tests missed it because they pass
-- headers directly to verifySender; nothing exercised the persistence hop
-- between the webhook and the sweep.
--
-- Stored as jsonb rather than parsed at ingest on purpose: the webhook's one
-- job is to durably record what arrived. Interpreting it is the sweep's job,
-- and keeping the raw array means a later change to the verification rules can
-- be re-run against mail already received.
alter table emails add column if not exists headers jsonb;

comment on column emails.headers is
  'Raw Postmark Headers array. Required by sender verification: DKIM lives here and nowhere else.';

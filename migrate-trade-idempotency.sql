-- ══════════════════════════════════════════════
-- TradeLadder — Migration: Trade Double-Submit Idempotency (F10)
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════
-- Adds idempotency_key column to the trades table so the server can dedupe
-- duplicate POSTs from a fast double-click or a retried network request.
-- The client generates a UUID per modal open and sends it in the body.
-- The (user_id, idempotency_key) pair must be unique when key is set.

ALTER TABLE trades ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique index: NULLs allowed (legacy rows, server-only inserts),
-- but if a key is set, only one row per user can hold it.
CREATE UNIQUE INDEX IF NOT EXISTS trades_user_idempotency_idx
  ON trades (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

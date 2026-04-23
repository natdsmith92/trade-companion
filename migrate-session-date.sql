-- ══════════════════════════════════════════════
-- TradeLadder — Migration: Add session_date
-- Run this if you already created the tables without session_date
-- ══════════════════════════════════════════════

ALTER TABLE plans ADD COLUMN IF NOT EXISTS session_date date;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS session_date date;

-- Backfill existing plans with their created_at date as session_date
UPDATE plans SET session_date = created_at::date WHERE session_date IS NULL;
UPDATE trades SET session_date = created_at::date WHERE session_date IS NULL;

-- Make session_date required going forward
ALTER TABLE plans ALTER COLUMN session_date SET NOT NULL;
ALTER TABLE trades ALTER COLUMN session_date SET NOT NULL;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_plans_session_date ON plans (session_date DESC);
CREATE INDEX IF NOT EXISTS idx_trades_session_date ON trades (session_date DESC);

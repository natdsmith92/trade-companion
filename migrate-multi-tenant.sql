-- ══════════════════════════════════════════════
-- TradeLadder — Migration: Multi-Tenant Auth
-- Run this in Supabase SQL Editor
-- ══════════════════════════════════════════════

-- Step 1: Add user_id to both tables
ALTER TABLE plans ADD COLUMN user_id uuid REFERENCES auth.users(id);
ALTER TABLE trades ADD COLUMN user_id uuid REFERENCES auth.users(id);

-- Step 2: Enable Row Level Security
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Step 3: Create policies — users can only see/edit their own data
CREATE POLICY "Users can view their own plans"
  ON plans FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own plans"
  ON plans FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plans"
  ON plans FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own trades"
  ON trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trades"
  ON trades FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own trades"
  ON trades FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own trades"
  ON trades FOR DELETE
  USING (auth.uid() = user_id);

-- Step 4: Allow the webhook (service key) to bypass RLS for ingestion
-- The service key already bypasses RLS, so the /api/ingest endpoint
-- will still work. It just needs to specify which user_id to assign.

-- Step 5: Index on user_id for fast queries
CREATE INDEX idx_plans_user_id ON plans (user_id);
CREATE INDEX idx_trades_user_id ON trades (user_id);

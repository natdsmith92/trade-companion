-- TradeLadder — Migration: the unique index /api/ingest has always assumed
--
-- WHY THIS EXISTS
-- src/app/api/ingest/route.ts upserts with:
--     .upsert({...}, { onConflict: "user_id,session_date" })
-- Postgres requires a UNIQUE index on exactly (user_id, session_date) to
-- satisfy ON CONFLICT. No committed SQL has ever created one — not schema.sql,
-- not migrate-multi-tenant.sql (which creates only a NON-unique idx_plans_user_id),
-- and not the reconciled schema from F5. The only unique index in the whole
-- database is trades_user_idempotency_idx.
--
-- So exactly one of these is true in production right now:
--   (a) the index was added by hand in the Supabase dashboard and is therefore
--       undocumented — this migration makes it explicit and idempotent, or
--   (b) it was never added, and EVERY ingest upsert has been failing with
--       42P10 "no unique or exclusion constraint matching the ON CONFLICT
--       specification".
--
-- Run the verification block at the bottom to find out which. Either way this
-- migration leaves the database in the documented, correct state.
--
-- The versioned-plans design (decision 5A) will later replace this with a
-- unique index on (user_id, session_date, version). Until then, one plan per
-- user per session is the invariant the application code already assumes.

-- ───── Pre-flight: surface duplicates before the index rejects them ─────
-- If this returns rows, the unique index cannot be created until they are
-- reconciled. Newest row per (user_id, session_date) is normally the keeper.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select user_id, session_date
    from plans
    where user_id is not null
    group by user_id, session_date
    having count(*) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'Cannot create unique index: % (user_id, session_date) pairs have duplicate rows. Reconcile them first (keep the newest created_at per pair).',
      dup_count;
  end if;
end $$;

-- ───── The index ─────
-- Partial: rows with a null user_id are legacy pre-multi-tenant data and are
-- excluded rather than blocking the migration.
create unique index if not exists plans_user_session_idx
  on plans (user_id, session_date)
  where user_id is not null;

-- ───── Verification ─────
-- Confirms the index now exists. Run this after applying:
--
--   select indexname, indexdef
--   from pg_indexes
--   where tablename = 'plans' and indexname = 'plans_user_session_idx';
--
-- To learn whether case (a) or (b) above was true, check whether ingest was
-- erroring before this ran:
--
--   select count(*) from plans where created_at > now() - interval '30 days';
--
-- A count of zero alongside a user who receives daily emails is strong
-- evidence of case (b).

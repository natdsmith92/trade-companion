-- TradeLadder — Migration: document the unique index /api/ingest depends on
--
-- WHAT THIS RESOLVED
-- src/app/api/ingest/route.ts upserts with:
--     .upsert({...}, { onConflict: "user_id,session_date" })
-- Postgres requires a UNIQUE index on exactly those columns or it raises 42P10.
-- No committed SQL had ever created one: not schema.sql, not
-- migrate-multi-tenant.sql (a plain non-unique index only), not the reconciled
-- F5 schema. That left two possibilities — an out-of-band index, or an ingest
-- path that had been failing on every call.
--
-- ANSWERED 2026-08-30 by querying production:
--     CREATE UNIQUE INDEX plans_user_session_unique
--       ON public.plans USING btree (user_id, session_date)
--
-- It exists. It was created by hand in the Supabase dashboard and never
-- written down. Ingest was never broken; the schema was merely undocumented.
-- This migration exists to close that gap, so a database rebuilt from
-- migrations alone gets the constraint the application code assumes.
--
-- Because the index already exists in production under a name we did not
-- choose, this checks for ANY unique index over those columns rather than
-- blindly creating one. Creating a second would enforce the same rule twice,
-- cost writes on every insert, and confuse the next reader.

do $$
declare
  existing text;
  dup_count integer;
begin
  -- Any unique index covering exactly (user_id, session_date), whatever it is
  -- called. pg_index.indkey is the ordered column list, resolved here against
  -- attnum so column ORDER is respected — a unique index on
  -- (session_date, user_id) would satisfy ON CONFLICT too, but we look for the
  -- declared order to keep this predicate honest and easy to reason about.
  select i.relname into existing
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  where t.relname = 'plans'
    and x.indisunique
    and (
      select array_agg(a.attname::text order by k.ord)
      from unnest(x.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    ) = array['user_id','session_date']
  limit 1;

  if existing is not null then
    raise notice
      'plans already has a unique index over (user_id, session_date): %. Nothing to do.',
      existing;
    return;
  end if;

  -- No index yet: this database was rebuilt from migrations, or the dashboard
  -- index was dropped. Verify the data can support the constraint before
  -- attempting it, so the failure message is about duplicates rather than a
  -- bare index-build error.
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
      'Cannot create the unique index: % (user_id, session_date) pair(s) have duplicate rows. Reconcile first, keeping the newest created_at per pair.',
      dup_count;
  end if;

  -- Partial: legacy rows predating multi-tenancy have a null user_id and are
  -- excluded rather than blocking the migration.
  execute $ix$
    create unique index plans_user_session_idx
      on plans (user_id, session_date)
      where user_id is not null
  $ix$;

  raise notice 'created plans_user_session_idx';
end $$;

-- ───── Verification ─────
--   select indexname, indexdef from pg_indexes where tablename = 'plans';
-- Expect exactly one unique index over (user_id, session_date) — either the
-- pre-existing plans_user_session_unique, or plans_user_session_idx on a
-- freshly built database. Never both.

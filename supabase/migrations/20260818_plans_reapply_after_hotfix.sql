-- ═══════════════════════════════════════════════════════════════════════════
-- SUPERSEDED — DO NOT RUN. Kept only so the filename does not get reused.
--
-- This file re-applied the plans contract by making `profiles.band_limit`
-- nullable again and re-running the plan-aware routines. That approach is
-- abandoned: it required production to be down (or `main` to be undeployed)
-- for the whole window, because `main` fails closed on a NULL `band_limit` and
-- the plan-aware routines resolve every account to the free plan's one band.
--
-- The plan system no longer touches `profiles.band_limit` at all. It has its
-- own column, `profiles.band_limit_override`, which is nullable by
-- construction and invisible to `main`. Two code paths, two columns, no
-- collision.
--
-- Use instead, in this order:
--
--   1. supabase/migrations/20260806_subscription_plans.sql
--        Additive only. Safe to run right now, with `main` live in production.
--
--   2. Deploy `feature/plans`.
--
--   3. supabase/migrations/20260807_plans_db_enforcement.sql
--        Swaps the band-limit trigger and RPC to the plan-aware versions.
--        Breaks `main`, so it must come after the deploy.
--
-- Rollback at any point: section 2 of
-- `20260817_hotfix_revert_plan_schema_contract.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  raise exception
    'This migration is superseded. Run 20260806_subscription_plans.sql, deploy '
    'feature/plans, then 20260807_plans_db_enforcement.sql.';
end $$;

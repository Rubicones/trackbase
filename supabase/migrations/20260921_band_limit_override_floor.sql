-- ═══════════════════════════════════════════════════════════════════════════
-- P1 — `profiles.band_limit_override` becomes a FLOOR, not a replacement.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ⚠ PAIRED WITH APPLICATION CODE. `resolveEntitlements()` in
--   `lib/entitlements.ts` changed in the same commit. The two implement the
--   same rule and must be applied together: while the app says
--   `max(override, base + addons)` and this function still says `override`,
--   the app offers a band the trigger then refuses with BL001, and the user
--   sees "band limit reached" on an allowance the UI just told them they had.
--
-- ── The rule ───────────────────────────────────────────────────────────────
--   override IS NULL      → base + extra_band addons        (unchanged)
--   override IS NOT NULL  → greatest(override, base + addons)   ← the change
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- The override exists to give grandfathered beta accounts and B2B deals an
-- allowance their plan would not. Replacing the computation made it a cap as
-- well as a floor, which is the wrong half of the deal in two ways:
--
--   · a grandfathered account with override 3 who BUYS band_plus (5) resolves
--     to 3 — they paid for an upgrade and got a downgrade;
--   · an `extra_band` addon on such an account grants nothing at all, at any
--     quantity, silently. The money moves; the capacity does not.
--
-- A floor keeps the promise the override was making ("you never drop below
-- this") and drops the one it was never meant to make ("and never rise above
-- it either").
--
-- ── Not covered here ───────────────────────────────────────────────────────
-- Nothing else changes: not the row lock, not the fail-closed BL002 path, not
-- the unknown-plan fallback, not the trigger, not `plan_limits`. This file
-- replaces one function body and one column comment.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. VERIFY FIRST — who this changes ════════════════════════════════════
--
-- Every account with an override whose plan+addons already grant more. These
-- are the accounts whose limit RISES the moment this runs. Expect a short
-- list (overrides are hand-granted); read it before and after so you can see
-- the same rows move.
--
--   select p.id,
--          p.plan,
--          p.band_limit_override                        as override,
--          l.bands_owned                                as plan_base,
--          coalesce(a.extra, 0)                         as extra_band_addons,
--          l.bands_owned + coalesce(a.extra, 0)         as computed,
--          greatest(p.band_limit_override,
--                   l.bands_owned + coalesce(a.extra, 0)) as new_limit,
--          p.band_limit_override                        as old_limit
--     from public.profiles p
--     join public.plan_limits l
--       on l.plan = coalesce(p.plan, 'free')
--     left join (
--            select user_id, sum(quantity) as extra
--              from public.plan_addons
--             where addon_type = 'extra_band'
--             group by user_id
--          ) a on a.user_id = p.id
--    where p.band_limit_override is not null
--      and p.band_limit_override < l.bands_owned + coalesce(a.extra, 0)
--    order by (l.bands_owned + coalesce(a.extra, 0)) - p.band_limit_override desc;
--
-- Nobody's limit can FALL: greatest() is never below either input. So there
-- is no account to warn, and no band to freeze, as a result of this file.


-- ═══ 1. effective_band_limit() ══════════════════════════════════════════════
--
-- Body identical to 20260807_plans_db_enforcement.sql except for the override
-- branch. Re-stated in full rather than patched, because `create or replace
-- function` has no partial form — and because the row lock, the BL002 raise
-- and the fail-closed plan fallback are load-bearing and belong in the same
-- file as the rule they guard.

create or replace function public.effective_band_limit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan     text;
  v_override integer;
  v_base     integer;
  v_addons   integer;
  v_computed integer;
begin
  select p.plan, p.band_limit_override
    into v_plan, v_override
    from public.profiles p
   where p.id = p_user_id
     for update;

  if not found then
    raise exception using
      errcode = 'BL002',
      message = 'band_limit_unknown',
      detail  = format('no profiles row for user %s', p_user_id);
  end if;

  select l.bands_owned into v_base
    from public.plan_limits l
   where l.plan = coalesce(v_plan, 'free');

  -- An unknown plan string falls back to the most restrictive answer rather
  -- than to "unlimited". Fail closed.
  if v_base is null then
    select l.bands_owned into v_base from public.plan_limits l where l.plan = 'free';
  end if;

  select coalesce(sum(a.quantity), 0)
    into v_addons
    from public.plan_addons a
   where a.user_id = p_user_id
     and a.addon_type = 'extra_band';

  v_computed := v_base + v_addons;

  -- The override is a FLOOR, not a replacement: it raises the allowance when
  -- the plan gives less, and gets out of the way when the plan gives more.
  -- Mirrors `resolveEntitlements()` in lib/entitlements.ts — change both
  -- together. `greatest` ignores NULL arguments, which is exactly the
  -- "no override" case, so no branch is needed.
  return greatest(v_override, v_computed);
end;
$$;

revoke all on function public.effective_band_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_band_limit(uuid) to service_role;


-- ═══ 2. The column comment ══════════════════════════════════════════════════
--
-- It described replacement semantics, which is now false in the direction
-- that costs money.

comment on column public.profiles.band_limit_override is
  'MANUAL FLOOR under the plan''s owned-bands limit. Non-null means the '
  'allowance is greatest(override, plan base + extra_band addons) — it raises '
  'a plan that gives less and never caps a plan that gives more. NULL means '
  '"use the plan". Grandfathered beta accounts and B2B deals only. Mirrored '
  'in resolveEntitlements() (lib/entitlements.ts) and effective_band_limit(); '
  'all three must agree.';


-- ═══ 3. Verify after ════════════════════════════════════════════════════════
--
-- The function's own answer against the computation, for every account that
-- has an override. `effective` must equal `expected` on every row.
--
--   select p.id,
--          p.plan,
--          p.band_limit_override as override,
--          greatest(p.band_limit_override,
--                   l.bands_owned + coalesce(a.extra, 0)) as expected,
--          public.effective_band_limit(p.id)              as effective
--     from public.profiles p
--     join public.plan_limits l
--       on l.plan = coalesce(p.plan, 'free')
--     left join (
--            select user_id, sum(quantity) as extra
--              from public.plan_addons
--             where addon_type = 'extra_band'
--             group by user_id
--          ) a on a.user_id = p.id
--    where p.band_limit_override is not null;
--
-- And the null-override path is untouched (expect effective = base + addons):
--
--   select public.effective_band_limit(p.id)
--     from public.profiles p
--    where p.band_limit_override is null
--    limit 5;

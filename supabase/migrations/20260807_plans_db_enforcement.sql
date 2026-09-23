-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription plans — PHASE 2: database-level enforcement.
--
-- ⛔ DO NOT RUN THIS WHILE `main` IS THE DEPLOYED BRANCH. ⛔
--
-- Run order, and it is not optional:
--   1. `20260806_subscription_plans.sql` (phase 1, additive, safe any time)
--   2. Deploy `feature/plans`
--   3. THIS FILE
--
-- ── Why it cannot go earlier ────────────────────────────────────────────────
-- This replaces the band-limit routines with plan-aware ones. Every existing
-- account is on 'free', which allows ONE owned band. `main` has no concept of
-- plans, so it would keep offering "create a space" and the database would
-- refuse with BL001 for anybody who already owns a band — which is most of
-- them. Phase 1 exists precisely so the schema can land without this.
--
-- ── What it changes ─────────────────────────────────────────────────────────
-- The DB's copy of the owned-bands rule becomes:
--     profiles.band_limit_override, when non-null (replaces everything), else
--     plan_limits[profiles.plan].bands_owned + sum(extra_band addons)
-- matching `resolveEntitlements()` in lib/entitlements.ts.
--
-- `profiles.band_limit` — the pre-plans column — stops being consulted. It is
-- left in place, NOT NULL, so a rollback to `main` still works without a data
-- migration. That is the entire reason it was not repurposed.
--
-- ── The gap this closes ─────────────────────────────────────────────────────
-- Between step 2 and step 3 the app enforces plans correctly but the DB still
-- enforces the old flat `band_limit` (3 for most accounts). For free and solo
-- that is harmless — the app's limit of 1 is stricter and rejects first. For
-- **Band+ it is not**: the plan allows 5 owned bands and the old trigger stops
-- the 4th with BL001. So do not linger between steps 2 and 3.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. Refuse to run out of order ══════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'band_limit_override'
  ) then
    raise exception
      'Phase 1 has not been applied. Run 20260806_subscription_plans.sql first.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'plan_addons'
       and column_name = 'addon_type'
  ) then
    raise exception
      'plan_addons is missing addon_type. Re-run 20260806_subscription_plans.sql, '
      'which repairs it.';
  end if;

  if not exists (select 1 from public.plan_limits) then
    raise exception 'plan_limits is empty. Re-run 20260806_subscription_plans.sql.';
  end if;
end $$;


-- ═══ 1. effective_band_limit() ══════════════════════════════════════════════
--
-- The database's copy of the owned-bands resolution rule.
--
-- Takes `for update` on the profiles row. That row lock is the concurrency
-- mechanism: concurrent attempts by the same user serialise behind it, so the
-- second of two simultaneous creates blocks until the first commits and then
-- (READ COMMITTED gives each statement a fresh snapshot) counts the row the
-- first one just inserted. Two requests at limit − 1 produce exactly one band.
--
-- There is deliberately no literal fallback. A user with no profiles row fails
-- closed with BL002 rather than being assumed onto some default.

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

  -- The override wins outright — plan base and addons included.
  if v_override is not null then
    return v_override;
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

  return v_base + v_addons;
end;
$$;

revoke all on function public.effective_band_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_band_limit(uuid) to service_role;


-- ═══ 2. The trigger ═════════════════════════════════════════════════════════
--
-- Ownership in this schema is `band_members (band_id, user_id, role='owner')`
-- — a `bands` row on its own has no owner, so a trigger on `bands` could not
-- know whose allowance to charge. It lives here, on the table that records
-- ownership, and fires at the exact moment the invariant can be violated.
--
-- Raises SQLSTATE 'BL001' / message 'band_limit_reached' / detail
-- 'limit=<n> current=<n>' so the API layer can translate it into the
-- structured `{ error: 'limit_reached', limit_type: 'bands', … }` response
-- instead of leaking a 500. See lib/bandLimit.ts.

create or replace function public.enforce_band_owner_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit   integer;
  v_current integer;
begin
  -- Only owner rows consume allowance. Joining a band as a member is free, on
  -- every plan, without limit — there is no membership cap anywhere.
  if new.role is distinct from 'owner' then
    return new;
  end if;

  -- An UPDATE that leaves an already-owned row owned by the same user is not a
  -- new claim of ownership (e.g. a role_label edit) — nothing to charge.
  if tg_op = 'UPDATE'
     and old.role = 'owner'
     and old.user_id = new.user_id then
    return new;
  end if;

  v_limit := public.effective_band_limit(new.user_id);

  select count(*)
    into v_current
    from public.band_members bm
   where bm.user_id = new.user_id
     and bm.role = 'owner'
     and bm.band_id is distinct from new.band_id;

  if v_current >= v_limit then
    raise exception using
      errcode = 'BL001',
      message = 'band_limit_reached',
      detail  = format('limit=%s current=%s', v_limit, v_current);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_band_owner_limit on public.band_members;

create trigger trg_enforce_band_owner_limit
  before insert or update of role, user_id on public.band_members
  for each row
  execute function public.enforce_band_owner_limit();


-- ═══ 3. Atomic band creation ════════════════════════════════════════════════
--
-- A PostgREST function call runs inside a single implicit transaction, so the
-- limit check and both inserts either all happen or none do.
--
-- The acting user is a parameter because the route resolves it from the
-- session; the function is not reachable by `anon` or `authenticated` (see the
-- grants), so a browser cannot call it with someone else's id.

create or replace function public.create_band_with_owner(
  p_user_id uuid,
  p_name    text
)
returns public.bands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit   integer;
  v_current integer;
  v_name    text := btrim(coalesce(p_name, ''));
  v_band    public.bands;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'p_user_id is required';
  end if;

  if v_name = '' then
    raise exception using errcode = '22023', message = 'p_name is required';
  end if;

  -- Takes the profiles row lock; see effective_band_limit().
  v_limit := public.effective_band_limit(p_user_id);

  select count(*)
    into v_current
    from public.band_members bm
   where bm.user_id = p_user_id
     and bm.role = 'owner';

  if v_current >= v_limit then
    raise exception using
      errcode = 'BL001',
      message = 'band_limit_reached',
      detail  = format('limit=%s current=%s', v_limit, v_current);
  end if;

  insert into public.bands (name)
       values (v_name)
    returning * into v_band;

  -- Charges the allowance. The trigger above re-checks here as a backstop.
  insert into public.band_members (band_id, user_id, role)
       values (v_band.id, p_user_id, 'owner');

  return v_band;
end;
$$;

revoke all on function public.create_band_with_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.create_band_with_owner(uuid, text) to service_role;


-- ═══ 4. Rolling back to `main` ══════════════════════════════════════════════
--
-- If the branch has to be reverted, re-run section 2 of
-- `20260817_hotfix_revert_plan_schema_contract.sql`. It restores both routines
-- to their `band_limit`-reading versions. No data migration is needed, because
-- `profiles.band_limit` was never repurposed and is still populated.


-- ═══ 5. Verify ══════════════════════════════════════════════════════════════
--
-- The effective limit should now track the plan, not the flat band_limit:
--   select p.username, p.plan, p.band_limit, p.band_limit_override,
--          public.effective_band_limit(p.id) as effective
--     from public.profiles p
--    order by effective desc
--    limit 20;
--
-- A free account with no override should read 1; a band_plus account, 5.

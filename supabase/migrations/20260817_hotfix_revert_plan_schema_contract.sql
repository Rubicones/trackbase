-- ═══════════════════════════════════════════════════════════════════════════
-- HOTFIX — production is broken. Run this now, top to bottom, in the Supabase
-- SQL editor.
--
-- ── What happened ───────────────────────────────────────────────────────────
-- `20260806_subscription_plans.sql` (branch `feature/plans`) was applied to the
-- production database, but the code that understands it was never deployed —
-- production still runs `main`. The schema and the application are now one
-- migration apart, in the direction that breaks.
--
-- Two independent failures, both visible in the logs:
--
--   1. GET /api/me/band-limit → 500 "Could not read band limit"
--      POST /api/bands        → 500
--      The plans migration ran `alter column band_limit drop not null` and
--      `drop default`. `handle_new_user` inserts only `(id)`, so **every
--      profile created since then has band_limit = NULL**. `main`'s
--      `getBandLimitStatus()` requires a number and fails closed with
--      'band_limit_unknown' (lib/bandLimit.ts:100). New accounts cannot get
--      past step 3 of onboarding.
--
--   2. POST /api/bands → 500, SQLSTATE 42703
--      'column a.addon_type does not exist'
--      The new `create_band_with_owner()` calls `effective_band_limit()`,
--      which reads `plan_addons.addon_type`. That column is not there — see
--      section 3, which diagnoses it rather than guessing.
--
-- ── What this file does ─────────────────────────────────────────────────────
-- Restores the database to the contract `main` was written against, and
-- nothing more. The plan COLUMNS and TABLES are left in place: they are purely
-- additive and `main` never reads them, so dropping them would be a second
-- risky change for no benefit and would only have to be undone at deploy time.
--
-- Reverting the two routines (rather than leaving the plan-aware ones and
-- relying on band_limit being non-null to short-circuit them) is deliberate.
-- The short-circuit would work today and fail the moment a single NULL
-- appeared — a latent trap that nothing in the deployed code would explain.
-- Production should run the schema its code was written for.
--
-- ⚠ BEFORE DEPLOYING `feature/plans`, see section 4. This file re-establishes
--   the default that the plans migration deliberately removes, so deploying
--   the branch without reading that section will give every account a
--   permanent band-limit override and silently disable the plan's own limit.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. Restore profiles.band_limit ═════════════════════════════════════════
--
-- Fixes failure 1, and on its own is enough to let people sign up again.
--
-- Backfill first, then re-establish the constraint — `set not null` fails if
-- any row still holds NULL, and here they certainly do.
--
-- The value follows the allowance rule already established in
-- `20260817_profiles_band_limit_column.sql`: (bands they own) + 3, so an
-- account gets the same three-band headroom a new account gets on top of what
-- it already holds. Every affected row was created in the last few days and
-- owns nothing, so in practice this is 3 — but the count is read rather than
-- assumed, in case anyone managed to create a band in the window.
--
-- Scoped to `band_limit is null` so it can never touch, or re-inflate, a value
-- that already exists. This is the same "escalator" hazard that file called
-- out: an unguarded `+ 3` run twice is silently wrong.

-- Any auth user without a profiles row would fail closed with BL002 forever.
insert into public.profiles (id)
select u.id
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
    on conflict (id) do nothing;

update public.profiles p
   set band_limit = 3 + (
         select count(*)
           from public.band_members bm
          where bm.user_id = p.id
            and bm.role = 'owner'
       )
 where p.band_limit is null;

alter table public.profiles alter column band_limit set default 3;
alter table public.profiles alter column band_limit set not null;

comment on column public.profiles.band_limit is
  'Per-user owned-band allowance (beta cap). NOT NULL, default 3; established '
  'users carry owned+3. Read it via lib/bandLimit.ts, never as a literal. '
  'NOTE: feature/plans redefines this column as a nullable OVERRIDE — see '
  'supabase/migrations/20260817_hotfix_revert_plan_schema_contract.sql §4 '
  'before deploying that branch.';


-- ═══ 2. Revert the two routines to their pre-plans definitions ══════════════
--
-- Fixes failure 2. Verbatim from `20260730_band_limit_enforcement.sql` — both
-- read `profiles.band_limit` directly and touch neither `plan_addons`,
-- `plan_limits`, nor `effective_band_limit()`, so the 42703 cannot recur no
-- matter what shape those objects are currently in.
--
-- Concurrency is unchanged: both take `SELECT … FOR UPDATE` on the profiles
-- row before counting, which serialises concurrent creates by the same user.

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
  -- Only owner rows consume allowance. Joining a band as a member is free.
  if new.role is distinct from 'owner' then
    return new;
  end if;

  -- An UPDATE that leaves an already-owned row owned by the same user is not
  -- a new claim of ownership (e.g. a role_label edit) — nothing to charge.
  if tg_op = 'UPDATE'
     and old.role = 'owner'
     and old.user_id = new.user_id then
    return new;
  end if;

  select p.band_limit
    into v_limit
    from public.profiles p
   where p.id = new.user_id
     for update;

  if not found then
    raise exception using
      errcode = 'BL002',
      message = 'band_limit_unknown',
      detail  = format('no profiles row for user %s', new.user_id);
  end if;

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

-- The trigger itself was never dropped, only re-pointed at the same function
-- name; recreating it here keeps this file self-contained if it ever runs
-- against a database where the plans migration did not complete.
drop trigger if exists trg_enforce_band_owner_limit on public.band_members;

create trigger trg_enforce_band_owner_limit
  before insert or update of role, user_id on public.band_members
  for each row
  execute function public.enforce_band_owner_limit();


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

  select p.band_limit
    into v_limit
    from public.profiles p
   where p.id = p_user_id
     for update;

  if not found then
    raise exception using
      errcode = 'BL002',
      message = 'band_limit_unknown',
      detail  = format('no profiles row for user %s', p_user_id);
  end if;

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


-- ═══ 3. Verify the fix ══════════════════════════════════════════════════════
--
-- Expect: no nulls, min at least 3, no users without a profile.

-- select count(*) filter (where band_limit is null) as null_limits,
--        min(band_limit)                            as min_limit,
--        count(*)                                   as profiles
--   from public.profiles;

-- select count(*) as users_without_profile
--   from auth.users u
--   left join public.profiles p on p.id = u.id
--  where p.id is null;

-- End to end, as the API does it — should return a number, not raise:
-- select public.create_band_with_owner('<your-user-uuid>', 'hotfix smoke test');
-- …then delete the band it made.


-- ═══ 4. What to do next ═════════════════════════════════════════════════════
--
-- Nothing about this file needs undoing later, and that is now by design.
--
-- The plan system no longer touches `profiles.band_limit`. Repurposing that
-- column is what caused this incident, and the fix is a second column rather
-- than a shared one: `profiles.band_limit_override`, nullable, invisible to
-- `main`. `band_limit` stays NOT NULL DEFAULT 3 permanently, which is also
-- what makes a rollback to `main` free at any point.
--
-- The rollout is three steps, and only the last one is disruptive:
--
--   1. `20260806_subscription_plans.sql` — additive only. New columns, new
--      tables, no changes to anything `main` reads. **Safe to run right now,
--      with production live.** It also repairs a half-applied earlier attempt
--      and seeds `band_limit_override` for the accounts that would otherwise
--      be pushed into a grace period the moment plans ship.
--
--   2. Deploy `feature/plans`.
--
--   3. `20260807_plans_db_enforcement.sql` — swaps the band-limit trigger and
--      RPC to the plan-aware versions. This one DOES break `main` (it resolves
--      every account to the free plan's single band), so it must come after
--      the deploy, and the gap between 2 and 3 should be short: in that window
--      the database still enforces the old flat limit of 3, which is stricter
--      than Band+ allows.
--
-- To roll back to `main` at any point, re-run section 2 above.

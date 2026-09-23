-- ═══════════════════════════════════════════════════════════════════════════
-- Restore the plan-aware band-limit enforcement that the 20260817 hotfix
-- overwrote.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ── Why this file exists instead of re-running 20260807 ────────────────────
--
-- The database was left in a state no single migration file describes:
--
--   effective_band_limit()      ← 20260921. Current. Floor semantics,
--                                 reads plan_limits and plan_addons.
--   enforce_band_owner_limit()  ← 20260817 hotfix. Reads profiles.band_limit.
--   create_band_with_owner()    ← 20260817 hotfix. Reads profiles.band_limit.
--
-- 20260807 was applied, then the hotfix ran AFTER it and did `create or
-- replace` on exactly those two callers, returning them to the pre-plans
-- contract. 20260921 was applied later still, but by design it replaces only
-- `effective_band_limit` ("Nothing else changes: … not the trigger") — so it
-- upgraded a function that nothing calls.
--
-- The visible symptom: an account on band_plus with an extra_band addon
-- resolves to 6 in the application and is refused at 3 by the database, 3
-- being `profiles.band_limit`'s default. The user is told "the most your plan
-- allows" about a number their plan has nothing to do with.
--
-- Re-running 20260807 would fix the two callers and silently REGRESS
-- `effective_band_limit`: its section 1 is a `create or replace` carrying the
-- old override-as-replacement rule. That file predates 20260921 and cannot
-- warn about it. This file therefore carries sections 2 and 3 of 20260807
-- verbatim and omits section 1 entirely. Nothing here touches
-- `effective_band_limit`, and nothing here should ever be made to.
--
-- ── What changes for whom ──────────────────────────────────────────────────
--
-- After this runs, the allowance is `effective_band_limit(user)` —
-- greatest(band_limit_override, plan base + extra_band addons) — and
-- `profiles.band_limit` stops being consulted by anything in the plan path.
-- Do NOT drop that column: branch `main` still reads it (see the tail of
-- 20260817).
--
-- The accounts that MOVE are the ones where the two numbers disagree. Run the
-- verification query below FIRST: any account owning more than the plan-aware
-- limit allows will enter grace and, two weeks later, lose bands. That is
-- correct behaviour for a real overage and a nasty surprise for an account
-- that was fine a minute earlier — give those a `band_limit_override` before
-- running this, not after.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. VERIFY FIRST ════════════════════════════════════════════════════════
--
-- (a) Confirm the premise — what is live right now. Expect
--     `effective_band_limit` to read plan_limits and plan_addons, and the two
--     callers not to mention it at all. If a caller already calls it, this
--     file has nothing to do.
--
--       select p.proname,
--              p.prosrc ilike '%effective_band_limit%' as calls_resolver,
--              p.prosrc ilike '%greatest(%'            as floor_semantics,
--              p.prosrc ilike '%plan_limits%'          as reads_plan_limits
--         from pg_proc p
--         join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public'
--          and p.proname in ('enforce_band_owner_limit',
--                            'create_band_with_owner',
--                            'effective_band_limit')
--        order by p.proname;
--
-- (b) Who this moves. Every account whose owned-band count exceeds what the
--     plan-aware resolver will grant it. Each row is an account that enters
--     grace the moment this runs.
--
--       select p.id, p.username, p.plan,
--              p.band_limit, p.band_limit_override,
--              (select count(*) from public.band_members m
--                where m.user_id = p.id and m.role = 'owner') as owned,
--              public.effective_band_limit(p.id)              as new_limit
--         from public.profiles p
--        where (select count(*) from public.band_members m
--                where m.user_id = p.id and m.role = 'owner')
--              > public.effective_band_limit(p.id)
--        order by owned desc;
--
--     `effective_band_limit` takes `for update` on the profiles row, so this
--     query locks every row it reads. Run it off-peak, or accept that it is a
--     brief lock on a table nothing writes to in a hot loop.
--
--     To spare an account listed here, give it a floor BEFORE running
--     section 1:
--
--       update public.profiles
--          set band_limit_override = <its current owned count>
--        where id = '<uuid>';


-- ═══ 1. The trigger ═════════════════════════════════════════════════════════
--
-- Verbatim from 20260807 section 2.
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


-- ═══ 2. Atomic band creation ════════════════════════════════════════════════
--
-- Verbatim from 20260807 section 3.
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


-- ═══ 3. Verify after ════════════════════════════════════════════════════════
--
-- (a) Both callers now resolve through the plan. All three `true`:
--
--       select p.proname,
--              p.prosrc ilike '%effective_band_limit%' as calls_resolver
--         from pg_proc p
--         join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public'
--          and p.proname in ('enforce_band_owner_limit', 'create_band_with_owner');
--
--     …and `effective_band_limit` is still the 20260921 body — this file did
--     not touch it, but check, because that is the whole point:
--
--       select p.prosrc ilike '%greatest(%' as floor_semantics
--         from pg_proc p
--         join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and p.proname = 'effective_band_limit';
--
-- (b) The number the application shows and the number the database enforces
--     now agree, for a specific account:
--
--       select public.effective_band_limit('<uuid>');
--
--     Compare with `limits.bandsOwned` in that user's GET /api/me/plan.
--
-- (c) The overage query from section 0(b) returns no rows.
--
-- (d) Smoke-test the refusal, rolled back:
--
--       begin;
--       select public.create_band_with_owner('<uuid of an at-limit account>', 'limit smoke test');
--       rollback;   -- expect ERROR band_limit_reached, SQLSTATE BL001

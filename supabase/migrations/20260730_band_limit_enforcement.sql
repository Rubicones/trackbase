-- Band ownership limit — database-level enforcement.
--
-- Companion to the already-applied `profiles.band_limit integer not null
-- default 3` column. This file adds the two DB objects the application relies
-- on. Run it in the Supabase SQL editor BEFORE deploying the code change:
-- `POST /api/bands` and `POST /api/projects` call `create_band_with_owner`
-- and fall back to a slower application-level path if it is missing.
--
-- ── Where the constraint lives, and why ──────────────────────────────────────
-- Ownership in this schema is NOT a column on `bands`; it is the row
-- `band_members (band_id, user_id, role = 'owner')`. A `bands` row on its own
-- has no owner, so a BEFORE INSERT trigger on `bands` could not know whose
-- allowance to charge. The trigger therefore lives on `band_members`, which is
-- the table that actually records ownership — it fires at the exact moment a
-- user becomes the owner of a band, which is the moment the invariant can be
-- violated.
--
-- ── Concurrency ──────────────────────────────────────────────────────────────
-- Both routines take `SELECT ... FROM profiles WHERE id = <owner> FOR UPDATE`
-- before counting. That row lock serialises every concurrent attempt by the
-- same user: the second transaction blocks until the first commits, and then
-- (READ COMMITTED gives each statement a fresh snapshot) counts the row the
-- first one just inserted. Two simultaneous requests at limit − 1 therefore
-- produce exactly one band, never two.
--
-- ── Error signalling ─────────────────────────────────────────────────────────
-- Both raise SQLSTATE 'BL001' with MESSAGE 'band_limit_reached' and DETAIL
-- 'limit=<n> current=<n>', so the API layer can translate it into the
-- structured `{ error: 'band_limit_reached', limit, current }` response
-- instead of leaking a generic 500. See `lib/bandLimit.ts`.
--
-- There is deliberately no literal fallback limit anywhere below. If a user
-- has no `profiles` row the routines fail closed rather than assuming 3 — a
-- grandfathered user must never be silently demoted to the default.

-- ─── 1. Trigger: enforce the limit whenever ownership is established ─────────

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

drop trigger if exists trg_enforce_band_owner_limit on public.band_members;

create trigger trg_enforce_band_owner_limit
  before insert or update of role, user_id on public.band_members
  for each row
  execute function public.enforce_band_owner_limit();

-- ─── 2. Atomic band creation ────────────────────────────────────────────────
-- A PostgREST function call runs inside a single implicit transaction, so the
-- limit check and both inserts either all happen or none do. This is the real
-- transaction the API route prefers over check-then-insert round trips.
--
-- The acting user is a parameter because the route resolves it from the
-- session; the function is NOT reachable by `anon` or `authenticated` (see the
-- grants below), so a browser cannot call it with someone else's id.

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

-- Server-side callers only. A client holding the anon key must not be able to
-- invoke this with a forged p_user_id.
revoke all on function public.create_band_with_owner(uuid, text) from public;
revoke all on function public.create_band_with_owner(uuid, text) from anon;
revoke all on function public.create_band_with_owner(uuid, text) from authenticated;
grant execute on function public.create_band_with_owner(uuid, text) to service_role;

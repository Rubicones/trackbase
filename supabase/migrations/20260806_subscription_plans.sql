-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription plans — schema, plan-aware limit enforcement, frozen bands.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5). Nothing here
--   is applied automatically, and the application code ships before it: until
--   this runs, `lib/entitlements.ts` detects the missing columns and keeps the
--   app in its pre-plans behaviour (legacy band_limit cap, 1 GB storage, no
--   feature gating, no freezing). Running this file is the switch that turns
--   the plan system on.
--
-- ⚠ READ SECTION 1 BEFORE RUNNING. It changes the meaning of
--   `profiles.band_limit` from "the limit" to "an override", and the choice of
--   how to migrate existing rows is a product decision, not a mechanical one.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. profiles — plan, grace, and band_limit's new meaning ════════════════
--
-- `band_limit` used to be `integer not null default 3` and WAS the limit. It
-- becomes a nullable MANUAL OVERRIDE: non-null replaces the plan's owned-bands
-- allowance entirely; null means "use the plan".
--
-- ── The decision you have to make ──────────────────────────────────────────
-- Every existing account currently holds a number in this column (3 for most,
-- higher for the users who were grandfathered earlier). Two options:
--
--   A) KEEP THEM AS OVERRIDES (what this file does). Every existing beta
--      account keeps the allowance it has today, regardless of plan. Nobody
--      wakes up over their limit because plans shipped. New accounts get null
--      and follow their plan. This is the conservative choice and it is what
--      "grandfathered beta accounts" in the spec describes.
--
--   B) CLEAR THE DEFAULTS. Uncomment the statement at the end of this section
--      to null out every row that still holds the old default of 3, so those
--      users fall to their plan's allowance — 1 band on free. That will put
--      every beta user who owns 2 or 3 bands straight into a grace period and,
--      14 days later, freeze their excess bands. Do this only deliberately,
--      and probably only after telling them.
--
-- You can move from A to B later with the same statement. You cannot easily
-- move back, because once cleared there is no record of what the value was.

alter table public.profiles
  add column if not exists plan text not null default 'free';

alter table public.profiles
  drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'solo', 'band', 'band_plus'));

-- band_limit: was the limit, is now the override.
alter table public.profiles alter column band_limit drop not null;
alter table public.profiles alter column band_limit drop default;

comment on column public.profiles.band_limit is
  'MANUAL OVERRIDE for the owned-bands limit. Non-null REPLACES the plan''s '
  'allowance (plan base + extra_band addons) entirely; it does not add to it. '
  'Null means "use the plan". Grandfathered beta accounts and B2B deals only.';

comment on column public.profiles.plan is
  'Subscription plan id. Mirrors lib/plans.ts. Stripe will one day write this '
  'column and insert plan_addons rows, and nothing else about the entitlement '
  'system needs to know that happened.';

-- Grace period after a downgrade that left structural conflicts. Null = none.
-- The account state (active / grace / enforced) is DERIVED from this column
-- and the actual data; it is never stored, and there is no cron job.
alter table public.profiles
  add column if not exists grace_until timestamptz;

-- The user's choice, made during grace, of which bands to keep when it ends.
-- Priority order. Stale or over-long values are tolerated and trimmed at the
-- moment they are applied (lib/freezeOrder.ts).
alter table public.profiles
  add column if not exists grace_keep_band_ids uuid[];

create index if not exists idx_profiles_grace_until
  on public.profiles (grace_until)
  where grace_until is not null;

-- ── Option B (see above). Leave commented unless you mean it. ──────────────
-- update public.profiles set band_limit = null where band_limit = 3;


-- ═══ 2. plan_addons ═════════════════════════════════════════════════════════
--
-- Capacity granted on top of a plan. Stripe will insert these rows later; the
-- dev tooling inserts them now. Nothing outside lib/entitlements.ts reads this
-- table.
--
--   extra_band    → +quantity owned bands, ACCOUNT-WIDE (band_id must be null)
--   extra_storage → +10 GB × quantity on ONE band (band_id required)
--   extra_member  → +quantity members on ONE band (band_id required)
--
-- The band_id CHECK is the point: storage is never pooled across bands, so an
-- account-wide storage addon has nowhere to land, and "more bands" is not a
-- property of any single band. Both are rejected rather than silently ignored.

create table if not exists public.plan_addons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  band_id     uuid references public.bands(id) on delete cascade,
  addon_type  text not null check (addon_type in ('extra_band', 'extra_storage', 'extra_member')),
  quantity    integer not null default 1 check (quantity > 0),
  created_at  timestamptz not null default now(),

  constraint plan_addons_scope_check check (
    (addon_type = 'extra_band'    and band_id is null) or
    (addon_type in ('extra_storage', 'extra_member') and band_id is not null)
  )
);

create index if not exists idx_plan_addons_user on public.plan_addons (user_id);
create index if not exists idx_plan_addons_band on public.plan_addons (band_id)
  where band_id is not null;

alter table public.plan_addons enable row level security;

-- Read-only to the owner; writes are service-role only. A client that could
-- insert here could grant itself capacity, which is the whole ballgame.
drop policy if exists "plan_addons_select_own" on public.plan_addons;
create policy "plan_addons_select_own" on public.plan_addons
  for select using (auth.uid() = user_id);


-- ═══ 3. bands — frozen state ════════════════════════════════════════════════
--
-- A frozen band is READ-ONLY. Nothing is ever deleted. Viewing, playback,
-- downloads and chat history keep working; every write is refused server-side.
-- Set lazily, when someone touches the band — there is no background job.

alter table public.bands
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_reason text;

alter table public.bands drop constraint if exists bands_frozen_reason_check;
alter table public.bands
  add constraint bands_frozen_reason_check
  check (frozen_reason is null or frozen_reason in ('plan_downgrade'));

create index if not exists idx_bands_frozen
  on public.bands (frozen_at)
  where frozen_at is not null;


-- ═══ 4. plan_limits — the trigger's copy of the plan table ══════════════════
--
-- ⚠ MIRROR OF `lib/plans.ts`. TypeScript is the source of truth for the
--   application; this table exists so the database trigger can enforce the
--   owned-bands limit without a round trip, which is the defence-in-depth that
--   makes the concurrency guarantee possible. **Change both together.** A
--   drift here does not break the app (the app never reads this table) — it
--   makes the DB backstop wrong, which is worse, because it fails silently in
--   whichever direction it drifted.
--
-- Only `bands_owned` is stored: it is the only limit the database enforces.
-- Members, storage and versions are enforced in application code, where the
-- band-scoped addon resolution lives.

create table if not exists public.plan_limits (
  plan        text primary key check (plan in ('free', 'solo', 'band', 'band_plus')),
  bands_owned integer not null check (bands_owned >= 0)
);

insert into public.plan_limits (plan, bands_owned) values
  ('free', 1),
  ('solo', 1),
  ('band', 3),
  ('band_plus', 5)
on conflict (plan) do update set bands_owned = excluded.bands_owned;

alter table public.plan_limits enable row level security;
-- Readable by anyone signed in (it is public pricing information); writable by
-- nobody but the service role.
drop policy if exists "plan_limits_read" on public.plan_limits;
create policy "plan_limits_read" on public.plan_limits for select using (true);


-- ═══ 5. effective_band_limit() ══════════════════════════════════════════════
--
-- The database's copy of the owned-bands resolution rule, matching
-- `resolveEntitlements()` in lib/entitlements.ts:
--
--   1. plan base, from plan_limits
--   2. + sum(quantity) of the user's extra_band addons
--   3. …unless profiles.band_limit is non-null, in which case that REPLACES
--      the whole computation.
--
-- Takes `for update` on the profiles row. That row lock is the concurrency
-- mechanism: every attempt by the same user serialises behind it, so the
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
  select p.plan, p.band_limit
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


-- ═══ 6. Replace the flat-cap trigger ════════════════════════════════════════
--
-- The previous version of this trigger read `profiles.band_limit` directly.
-- That column is now a nullable override, so the old trigger is wrong twice
-- over: it ignores the plan, and it would treat a null override as "no limit
-- readable" and fail closed on every create by a normal account.
--
-- Ownership in this schema is `band_members (band_id, user_id, role='owner')`
-- — a `bands` row on its own has no owner, so a trigger on `bands` could not
-- know whose allowance to charge. It therefore lives here, on the table that
-- actually records ownership, and fires at the exact moment the invariant can
-- be violated.
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


-- ═══ 7. Atomic band creation, plan-aware ════════════════════════════════════
--
-- A PostgREST function call runs inside a single implicit transaction, so the
-- limit check and both inserts either all happen or none do. This is the real
-- transaction the API route prefers over check-then-insert round trips.
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


-- ═══ 8. Sanity checks (run these after applying) ════════════════════════════
--
-- select id, plan, band_limit, grace_until from public.profiles limit 20;
-- select * from public.plan_limits order by bands_owned;
-- select public.effective_band_limit('<a-user-uuid>');
-- select id, name, frozen_at, frozen_reason from public.bands where frozen_at is not null;

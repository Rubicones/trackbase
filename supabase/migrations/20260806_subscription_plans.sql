-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription plans — PHASE 1: additive only. Safe to run while `main` is
-- live in production.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ── Read this if you are wondering why the file is shaped like this ─────────
-- An earlier version of this migration changed `profiles.band_limit` from
-- `not null default 3` into a nullable override, and replaced the two
-- band-limit routines with plan-aware ones. Applied to the production database
-- while `main` was still deployed, it took down signup: `handle_new_user`
-- inserts only `(id)`, so with the default gone every new profile got
-- band_limit = NULL, and `main`'s `getBandLimitStatus()` fails closed on a
-- non-number. Band creation died separately on a 42703 from the new routines.
-- See `20260817_hotfix_revert_plan_schema_contract.sql`.
--
-- This version cannot do that, because it obeys one rule:
--
--   ★ NOTHING HERE MAY CHANGE ANYTHING `main` READS. ★
--
-- `profiles.band_limit` keeps its type, its NOT NULL, and its DEFAULT 3.
-- `enforce_band_owner_limit()` and `create_band_with_owner()` are not touched.
-- Everything else is a new column or a new table, which `main` never selects
-- and therefore cannot notice.
--
-- The override that the plan system needs moved to its own column,
-- `profiles.band_limit_override`. That separation is the whole fix: the two
-- apps stop fighting over the meaning of one column, and "3" stops silently
-- meaning "ignore this account's plan".
--
-- ── Phase 2 ────────────────────────────────────────────────────────────────
-- The database-level enforcement (the plan-aware trigger and RPC) CANNOT be
-- installed while `main` runs — it would resolve every user to the free plan's
-- 1 band and lock established users out of band creation. It lives in
-- `20260807_plans_db_enforcement.sql` and is run AFTER the branch is deployed.
--
-- Until then the app layer on the branch enforces plans on its own, and the
-- old trigger stays as the race-condition backstop it always was. The one gap
-- is Band+ (5 owned bands) against the old trigger's 3 — see phase 2's header.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. Repair, if the breaking version was ever applied here ═══════════════
--
-- No-op on a database that never saw it. On one that did — and where the
-- hotfix has not been run — this restores what `main` needs before anything
-- else happens. `set not null` fails while any row is NULL, so backfill first.

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
  'Per-user owned-band allowance used by the pre-plans code path (`main`). '
  'NOT NULL, default 3. The plan system does NOT read this column — it reads '
  'band_limit_override. Do not repurpose it again.';


-- ═══ 1. profiles — plan, grace, and the override in its own column ══════════

alter table public.profiles
  add column if not exists plan text not null default 'free';

alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles
  add constraint profiles_plan_check
  check (plan in ('free', 'solo', 'band', 'band_plus'));

comment on column public.profiles.plan is
  'Subscription plan id. Mirrors lib/plans.ts. Stripe will one day write this '
  'column and insert plan_addons rows, and nothing else about the entitlement '
  'system needs to know that happened. Ignored entirely by `main`.';

-- The manual override, in its own nullable column so `main`'s NOT NULL
-- `band_limit` can coexist with it. Non-null REPLACES the plan's owned-bands
-- allowance (plan base + extra_band addons) outright; it does not add to it.
-- NULL — the default for every account — means "use the plan".
alter table public.profiles
  add column if not exists band_limit_override integer;

comment on column public.profiles.band_limit_override is
  'MANUAL OVERRIDE for the plan''s owned-bands limit. Non-null REPLACES the '
  'plan allowance entirely. NULL means "use the plan". Grandfathered beta '
  'accounts and B2B deals only.';

-- Grace period after a downgrade that left structural conflicts. Null = none.
-- The account state (active / grace / enforced) is DERIVED from this column
-- and the actual data; it is never stored, and there is no cron job.
alter table public.profiles
  add column if not exists grace_until timestamptz;

-- The user's choice, made during grace, of which bands survive when it ends.
-- Priority order. Stale entries are tolerated and trimmed on use.
alter table public.profiles
  add column if not exists grace_keep_band_ids uuid[];

create index if not exists idx_profiles_grace_until
  on public.profiles (grace_until)
  where grace_until is not null;


-- ═══ 2. bands — frozen state ════════════════════════════════════════════════
--
-- A frozen band is READ-ONLY. Nothing is ever deleted. Viewing, playback,
-- downloads and chat history keep working; every write is refused. Set lazily,
-- when someone touches the band — there is no background job. `main` does not
-- select these columns, so they are inert until the branch ships.

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


-- ═══ 3. plan_addons ═════════════════════════════════════════════════════════
--
--   extra_band    → +quantity owned bands, ACCOUNT-WIDE (band_id must be null)
--   extra_storage → +10 GB × quantity on ONE band (band_id required)
--   extra_member  → +quantity members on ONE band (band_id required)
--
-- The band_id CHECK is the point: storage is never pooled across bands, so an
-- account-wide storage addon has nowhere to land, and "more bands" is not a
-- property of any single band. Both are rejected rather than silently ignored.

-- A `plan_addons` from an earlier draft may exist with the wrong column set —
-- that is where the production `42703 column a.addon_type does not exist` came
-- from, because `create table if not exists` silently skipped it. Repair it
-- while it is empty rather than leaving a half-right table in place.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'plan_addons')
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public'
                        and table_name   = 'plan_addons'
                        and column_name  = 'addon_type')
  then
    if (select count(*) from public.plan_addons) > 0 then
      raise exception
        'plan_addons exists without addon_type and is NOT empty. Inspect it by '
        'hand; refusing to drop rows.';
    end if;
    raise notice 'Dropping empty legacy plan_addons so it can be recreated correctly.';
    drop table public.plan_addons;
  end if;
end $$;

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


-- ═══ 4. plan_limits — the trigger's copy of the plan table ══════════════════
--
-- ⚠ MIRROR OF `lib/plans.ts`. TypeScript is the source of truth for the
--   application; this table exists so phase 2's trigger can enforce the
--   owned-bands limit without a round trip. **Change both together.** A drift
--   here does not break the app (the app never reads this table) — it makes
--   the DB backstop wrong, which is worse, because it fails silently.

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
drop policy if exists "plan_limits_read" on public.plan_limits;
create policy "plan_limits_read" on public.plan_limits for select using (true);


-- ═══ 5. Seed the override for accounts that would otherwise be disrupted ════
--
-- Everyone is on 'free' at this point, which allows 1 owned band. An existing
-- beta user who owns 3 would drop into a grace period the instant the branch
-- deploys, and lose two bands two weeks later — because plans shipped, not
-- because they did anything.
--
-- So: give an override to exactly the people who own more than their plan
-- allows, and to nobody else. New accounts, and anyone already inside their
-- plan's allowance, keep NULL and follow their plan normally. This is the
-- narrowest rule that preserves the status quo, and it is why the override is
-- seeded here rather than left as a judgement call at deploy time.
--
-- `band_limit_override is null` guards it: re-running never re-inflates a
-- value, and never overwrites one set by hand afterwards.

update public.profiles p
   set band_limit_override = greatest(owned.n, p.band_limit)
  from (
    select user_id, count(*)::integer as n
      from public.band_members
     where role = 'owner'
     group by user_id
  ) owned
 where owned.user_id = p.id
   and p.band_limit_override is null
   and owned.n > (
     select l.bands_owned from public.plan_limits l
      where l.plan = coalesce(p.plan, 'free')
   );


-- ═══ 6. Deliberately NOT done here ══════════════════════════════════════════
--
-- `enforce_band_owner_limit()` and `create_band_with_owner()` are left exactly
-- as `main` needs them, reading `profiles.band_limit`. Replacing them with the
-- plan-aware versions while `main` is deployed would resolve every user to
-- free's single band and break band creation for every established account.
--
-- That swap is `20260807_plans_db_enforcement.sql`, run after the branch is
-- deployed. Do not run it early "to save a step".


-- ═══ 7. Verify ══════════════════════════════════════════════════════════════
--
-- `main` still works — no nulls, default intact:
--   select count(*) filter (where band_limit is null) as broken_rows,
--          count(*) as profiles
--     from public.profiles;
--
-- Who got an override, and why:
--   select p.username, p.plan, p.band_limit, p.band_limit_override,
--          count(bm.band_id) filter (where bm.role = 'owner') as owned
--     from public.profiles p
--     left join public.band_members bm on bm.user_id = p.id
--    group by p.id, p.username, p.plan, p.band_limit, p.band_limit_override
--   having p.band_limit_override is not null;
--
-- New objects are present:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='profiles'
--      and column_name in ('plan','grace_until','grace_keep_band_ids','band_limit_override');
--   select * from public.plan_limits order by bands_owned;

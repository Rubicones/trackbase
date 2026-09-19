-- profiles.band_limit — the per-user owned-band allowance.
--
-- ── Why this file exists ─────────────────────────────────────────────────────
-- `20260730_band_limit_enforcement.sql` described this column as
-- "already-applied" and only created the trigger and the RPC that read it. No
-- file in this directory ever created the column, and it was never added to the
-- live database, so every read of it failed:
--
--   GET  /api/me/band-limit  ->  500 { error: "Could not read band limit" }
--   POST /api/bands          ->  500 { error: "Internal server error" }
--
-- which blocks step 3 of onboarding ("create a space") for every new account.
-- The generic message on POST is the tell: a missing *profiles row* is caught
-- explicitly and answers "Could not verify your band limit", so a raw
-- PostgREST error (42703, undefined_column) is the only way to reach the
-- generic branch. See `lib/bandLimit.ts` `getBandLimitStatus()`.
--
-- ── The allowance rule ───────────────────────────────────────────────────────
-- New accounts:      3.
-- Accounts existing at migration time: (bands they already own) + 3, so every
--                    established user gets the same three-band headroom a new
--                    user gets, on top of what they already hold.
--
-- ── Run order ────────────────────────────────────────────────────────────────
-- Run this file BEFORE `20260730_band_limit_enforcement.sql`. Both routines in
-- that file select `p.band_limit` and fail closed without it. If the
-- enforcement file has already been run, running this one now is enough — the
-- functions resolve the column at call time, not at definition time.
--
-- ── Idempotency (load-bearing) ───────────────────────────────────────────────
-- The grandfather step adds 3 to a *live* count, so running it twice would give
-- an established user +3 again, and again — an unbounded escalator, silently.
-- It is therefore guarded on "did this statement just create the column?"
-- rather than on the data. That is the only condition that is true exactly once
-- no matter how often the file is run, which is why the ALTER and the UPDATE
-- share one DO block instead of being two top-level statements.

-- ─── 1. Backfill missing profiles rows ──────────────────────────────────────
-- First, because step 2 grandfathers per profiles row: a user with no row would
-- otherwise be skipped and silently land on the default 3 despite owning bands.
--
-- The deployed `handle_new_user` trigger is only
-- `insert into public.profiles (id) values (new.id)`, and both band-limit
-- routines fail closed (SQLSTATE BL002, 'band_limit_unknown') when a user has
-- no profiles row. An auth user created while the trigger was absent or failing
-- would be permanently unable to create a band, so give them a row.

insert into public.profiles (id)
select u.id
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
    on conflict (id) do nothing;

-- ─── 2. The column, plus a one-shot grandfather ─────────────────────────────

do $$
declare
  v_column_existed boolean;
  v_grandfathered  integer;
begin
  select exists (
           select 1
             from information_schema.columns
            where table_schema = 'public'
              and table_name   = 'profiles'
              and column_name  = 'band_limit'
         )
    into v_column_existed;

  if v_column_existed then
    raise notice 'profiles.band_limit already exists — leaving every value untouched.';
    return;
  end if;

  -- Default 3 is the beta-wide cap for everyone created from here on. It is a
  -- *default*, never a constant in code: the grandfathering below gives
  -- established users a higher personal value, which is the entire reason the
  -- allowance is a column and not a literal. See AGENTS.md §7.
  alter table public.profiles
    add column band_limit integer not null default 3;

  -- Ownership is `band_members.role = 'owner'` (not a column on `bands`), so
  -- the count comes from there. The CTE only yields users who own at least one
  -- band; everyone else keeps the default, which is already 0 + 3.
  with owned as (
    select user_id, count(*)::integer as n
      from public.band_members
     where role = 'owner'
     group by user_id
  )
  update public.profiles p
     set band_limit = owned.n + 3
    from owned
   where owned.user_id = p.id;

  get diagnostics v_grandfathered = row_count;
  raise notice 'profiles.band_limit created (default 3); grandfathered % existing owner(s) to owned+3.',
    v_grandfathered;
end $$;

-- ─── 3. Verify ──────────────────────────────────────────────────────────────
-- Every user should have a row, no nulls, and every limit should be at least 3
-- and exactly (owned + 3) for anyone who owned a band before this ran:
--
--   select p.id,
--          p.username,
--          p.band_limit,
--          count(bm.band_id) filter (where bm.role = 'owner') as owned
--     from public.profiles p
--     left join public.band_members bm on bm.user_id = p.id
--    group by p.id, p.username, p.band_limit
--    order by owned desc, p.band_limit desc;
--
--   select count(*) filter (where band_limit is null) as null_limits,
--          min(band_limit) as min_limit
--     from public.profiles;
--
--   select count(*) as users_without_profile
--     from auth.users u
--     left join public.profiles p on p.id = u.id
--    where p.id is null;

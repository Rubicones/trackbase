-- Terms acceptance — record which Terms of Service a new account accepted.
--
-- NOTHING IN THIS FILE IS ACTIVE UNTIL IT IS RUN (manual, AGENTS.md §5).
-- The notice on /auth ("By continuing, you agree to our Terms of Service and
-- acknowledge our Privacy Policy") ships with the code; this file is what
-- makes the acceptance get recorded.
--
-- ── What it does ────────────────────────────────────────────────────────────
--   1. `public.current_terms_version()` — THE one place the current Terms
--      version lives (the Terms "last updated" date, ISO). Changing the Terms
--      means re-running only that `create or replace function` with the new
--      date, and bumping `LEGAL_LAST_UPDATED.terms` in
--      components/legal/LegalDocument.tsx (the human-readable date on /terms).
--   2. `handle_new_user` additionally writes `terms_accepted_at = now()` and
--      `terms_version = current_terms_version()` on the profile row it creates.
--      Same statement, same transaction as the row itself. It fires only on
--      INSERT into auth.users, so existing users signing in are never touched.
--   3. Revokes INSERT on profiles from anon/authenticated. UPDATE is already
--      column-granted without the terms columns (20260806_lock_entitlement_
--      columns.sql); INSERT was still table-wide, which is the one remaining
--      way a browser could supply its own terms_* values.
--
-- ── Why the trigger body is checked before it is replaced ──────────────────
-- AGENTS.md §5: the live `handle_new_user` is NOT what 001_auth.sql shows; it
-- is documented as `insert into public.profiles (id) values (new.id)`. This
-- file replaces the function, so if the live body has since grown anything
-- else, a blind `create or replace` would silently delete it. The guard below
-- refuses to run unless the live body is exactly the documented one (or this
-- file's own version — re-running is safe) and prints what it found.
--
-- Creates profiles.terms_accepted_at (timestamptz) and profiles.terms_version
-- (text) if they are missing (they were assumed added by hand, but were not).
-- Both nullable, no default: accounts created before this file stay NULL.
--
-- Note: Supabase creates the auth.users row on `signInWithOtp` (the Continue
-- click, which is where the notice is shown), not on code verification.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ═══ 0a. Columns ════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     text;

comment on column public.profiles.terms_accepted_at is
  'When the account accepted the Terms (sign-up). Written only by handle_new_user.';
comment on column public.profiles.terms_version is
  'Terms version accepted at sign-up = current_terms_version() at that time. Written only by handle_new_user.';

-- ═══ 0b. Preconditions ═══════════════════════════════════════════════════════
do $$
declare
  v_src   text;
  v_norm  text;
  v_secdef boolean;
begin
  -- `if not exists` above skips a same-named column of the wrong type.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and ((column_name = 'terms_accepted_at' and data_type = 'timestamp with time zone')
           or (column_name = 'terms_version'     and data_type = 'text'))) <> 2 then
    raise exception 'profiles.terms_accepted_at must be timestamptz and profiles.terms_version text.';
  end if;

  select p.prosrc, p.prosecdef
    into v_src, v_secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user';

  if v_src is null then
    raise exception 'public.handle_new_user() not found — not touching signup.';
  end if;

  -- Compare with all whitespace removed and lower-cased.
  v_norm := regexp_replace(lower(v_src), '\s+', '', 'g');

  if v_norm not in (
       -- documented live body (AGENTS.md §5)
       'begininsertintopublic.profiles(id)values(new.id);returnnew;end;',
       -- this file's body (re-run)
       'begininsertintopublic.profiles(id,terms_accepted_at,terms_version)values(new.id,now(),public.current_terms_version());returnnew;end;'
     ) then
    raise exception E'handle_new_user body is not the expected one — not replacing it. Live source:\n%', v_src;
  end if;

  if not v_secdef then
    raise exception 'handle_new_user is not SECURITY DEFINER — unexpected; not replacing it.';
  end if;
end $$;


-- ═══ 1. The one terms version ═══════════════════════════════════════════════
-- Bump this date (and only this, DB-side) when the Terms change.
create or replace function public.current_terms_version()
returns text
language sql
stable
as $$ select '2026-09-23'::text $$;

comment on function public.current_terms_version() is
  'Current Terms of Service version (ISO "last updated" date). Written to profiles.terms_version by handle_new_user. Keep in step with LEGAL_LAST_UPDATED.terms.';


-- ═══ 2. Record acceptance where the profile is created ══════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, terms_accepted_at, terms_version)
  values (new.id, now(), public.current_terms_version());
  return new;
end;
$$;


-- ═══ 3. The browser cannot write the terms columns ══════════════════════════
revoke insert on public.profiles from anon, authenticated;

do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'terms_accepted_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'terms_version', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'terms_accepted_at', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'terms_version', 'UPDATE') then
    raise exception 'anon/authenticated can UPDATE a terms column — re-run 20260806_lock_entitlement_columns.sql first.';
  end if;
end $$;

commit;


-- ── Verify (run after) ──────────────────────────────────────────────────────
--
-- 3. No client write path — every row must be false:
--   select r, c, p, has_column_privilege(r, 'public.profiles', c, p)
--     from unnest(array['anon','authenticated']) r,
--          unnest(array['terms_accepted_at','terms_version']) c,
--          unnest(array['INSERT','UPDATE']) p;
--
-- 1. After a NEW sign-up (fresh email on /auth), newest profiles:
--   select p.id, u.email, u.created_at, p.terms_accepted_at, p.terms_version
--     from public.profiles p join auth.users u on u.id = p.id
--    order by u.created_at desc limit 5;
--   → the new row has terms_accepted_at ≈ u.created_at and '2026-09-23'.
--
-- 2. Existing user: note their row, sign in, re-run — unchanged (NULLs for
--    anyone created before this file ran):
--   select terms_accepted_at, terms_version from public.profiles
--    where id = (select id from auth.users where email = '<existing email>');

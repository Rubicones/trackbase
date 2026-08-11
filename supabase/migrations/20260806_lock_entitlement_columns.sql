-- ═══════════════════════════════════════════════════════════════════════════
-- Lock the entitlement columns against direct client writes.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5), and run it
--   SOON — until it is applied, any signed-in user can grant themselves
--   `band_plus` and an unlimited band allowance from the browser console with
--   the public anon key. There is no application change that closes this;
--   the hole is in the database's own permissions.
--
-- ── The problem ────────────────────────────────────────────────────────────
-- `profiles` carries a self-update RLS policy from 001_auth.sql:
--
--     create policy "profiles_update" on public.profiles
--       for update using (auth.uid() = id);
--
-- That was correct when the table held a username, a display name and an
-- avatar colour. 20260806_subscription_plans.sql then added `plan`,
-- `grace_until` and `grace_keep_band_ids` to the same table, and turned
-- `band_limit` into an override — i.e. it added the crown jewels to a table
-- the browser is allowed to write.
--
-- **RLS is row-level, not column-level.** A policy decides WHICH ROWS a role
-- may update; it says nothing about which columns. Column control is a GRANT.
-- Supabase's default grants give `authenticated` UPDATE on every column of
-- every table in `public`, so the policy above authorises:
--
--     supabase.from('profiles')
--       .update({ plan: 'band_plus', band_limit: 9999, grace_until: null })
--       .eq('id', <my own id>)
--
-- …from any browser tab. The row is the user's own, so the policy passes.
-- `components/PreferencesModal.tsx` already does exactly this shape of write
-- for `username`, which is what proves the path is open.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- Narrow the grant instead of the policy. `authenticated` keeps UPDATE on the
-- columns it legitimately edits and loses it on the four that decide what the
-- account is entitled to. The service role is unaffected (it bypasses both RLS
-- and column grants), so every server route in `lib/planChange.ts`,
-- `lib/bandFreeze.ts` and `/api/dev/plan` keeps working unchanged.
--
-- Revoking the table-wide UPDATE first is required: a table-level grant
-- subsumes any column list, so column grants only take effect once it is gone.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. profiles — column-level UPDATE ══════════════════════════════════════

revoke update on public.profiles from anon, authenticated;

-- The columns a user may edit about themselves. If a future migration adds a
-- user-editable column to `profiles`, it must be added here too — the default
-- after this migration is "not writable by the client", which is the direction
-- we want to fail in.
grant update (
  username,
  display_name,
  avatar_color,
  onboarding
) on public.profiles to authenticated;

-- Deliberately NOT granted, and why:
--   plan                  the subscription itself
--   band_limit            the manual override; replaces the plan allowance
--   grace_until           decides when freezing starts
--   grace_keep_band_ids   decides which bands survive freezing
--   acquisition_source    write-once attribution (PATCH /api/profile/username)
--   cohort                       "
--   id                    identity

-- `anon` has no business updating a profile at all; the revoke above is the
-- whole story for that role.

-- Add the missing WITH CHECK. `using` alone constrains which rows may be
-- targeted but not what they may become, so without this a user could rewrite
-- their own row's `id`. Harmless today only because `id` is the primary key and
-- references auth.users — not a property worth relying on.
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ═══ 2. bands — frozen_at / frozen_reason are enforcement state ═════════════
--
-- Frozen state is read-only to clients by the same argument: a user who can
-- clear `frozen_at` un-freezes their own over-limit band. The service role sets
-- it (lib/bandFreeze.ts) and nothing else should.
--
-- This revoke is broader than the plan system strictly needs — no client code
-- writes `bands` directly today (every mutation goes through an API route on
-- the service-role client), so removing the grant costs nothing and closes the
-- column for good.

revoke insert, update, delete on public.bands from anon, authenticated;


-- ═══ 3. band_members — ownership is capacity ════════════════════════════════
--
-- `role = 'owner'` IS the owned-band count. A client that can insert an owner
-- row here mints band allowance directly, and one that can update `role` grants
-- itself ownership of a band it merely joined. The `trg_enforce_band_owner_limit`
-- trigger would still fire, but the trigger enforces a ceiling — it does not
-- make the write legitimate. Creation goes through `create_band_with_owner()`
-- on the service role; membership changes go through the API routes.

revoke insert, update, delete on public.band_members from anon, authenticated;


-- ═══ 4. plan_addons / plan_limits — belt and braces ═════════════════════════
--
-- Both already rely on "RLS enabled, no write policy", which is sufficient.
-- The explicit revoke is defence in depth: it survives someone later adding a
-- convenience `for all` policy without thinking about the write half.

revoke insert, update, delete on public.plan_addons from anon, authenticated;
revoke insert, update, delete on public.plan_limits from anon, authenticated;


-- ═══ 5. Verification — run these after applying ═════════════════════════════
--
-- Which columns can `authenticated` still write on profiles?
-- Expect exactly: username, display_name, avatar_color, onboarding.
--
--   select column_name
--     from information_schema.column_privileges
--    where table_schema = 'public'
--      and table_name   = 'profiles'
--      and grantee      = 'authenticated'
--      and privilege_type = 'UPDATE'
--    order by column_name;
--
-- Table-level writes that should now be empty for anon/authenticated:
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name in ('bands','band_members','plan_addons','plan_limits','profiles')
--      and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE','DELETE')
--    order by table_name, grantee, privilege_type;
--
-- ── Also verify the SECURITY DEFINER grants from the plans migration ────────
-- These were written as REVOKE/GRANT in 20260806_subscription_plans.sql but
-- have never been confirmed against the live database. Both functions take a
-- user id as a parameter, so if either is executable by `authenticated`, a
-- browser can pass someone else's uuid — or its own, to create a band straight
-- past the API layer. Expect NO rows for anon/authenticated:
--
--   select p.proname,
--          r.rolname as grantee,
--          has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
--     from pg_proc p
--     cross join (select unnest(array['anon','authenticated','service_role']) as rolname) r
--    where p.proname in ('effective_band_limit','create_band_with_owner')
--      and p.pronamespace = 'public'::regnamespace;
--
-- Every SECURITY DEFINER function in the schema, with its search_path — check
-- that nothing is missing `search_path=public` and that nothing unexpected is
-- executable by a client role:
--
--   select p.proname,
--          p.prosecdef,
--          p.proconfig,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
--     from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.prosecdef
--    order by p.proname;
--
-- RLS must be ON for every table in this system. Expect rowsecurity = true for
-- all of them (bands / band_members / projects / versions / tracks predate the
-- migrations directory and have never been confirmed here):
--
--   select tablename, rowsecurity
--     from pg_tables
--    where schemaname = 'public'
--      and tablename in (
--            'profiles','bands','band_members','projects','versions','tracks',
--            'track_comments','comment_replies','sections','project_resources',
--            'plan_addons','plan_limits','band_messages','band_activity',
--            'band_join_requests','subscription_intents'
--          )
--    order by tablename;

-- Deletion invariants — database-level enforcement.
--
-- NOTHING IN THIS FILE IS ACTIVE UNTIL IT IS RUN. Migrations in this repo are
-- applied by hand (AGENTS.md §7), so until somebody pastes this into the
-- Supabase SQL editor the only thing standing between production and an
-- ownerless band is the application code in `lib/bandDelete.ts` and the three
-- API routes that call it. That code is already correct on its own; these
-- triggers exist so that a future code path, a migration script, a support
-- query typed into the SQL editor at 2am, or `delete from auth.users` cannot
-- get it wrong. Read `-- ── Before you run this ──` at the bottom first: it has
-- the queries that tell you whether the data already violates the invariants,
-- in which case this file will fail to do anything useful until you fix them.
--
-- ── The two invariants ───────────────────────────────────────────────────────
--
--   1. A band can be deleted only when its owner is the only member.
--   3. A band can never become ownerless.
--
-- (Invariants 2 and 4 from the specification — an account can be deleted only
-- when the user owns no bands, and deleting a band purges its R2 objects — are
-- deliberately NOT here. Invariant 2 is a consequence of invariant 3 once this
-- file is applied: deleting a user cascades their `band_members` rows, and the
-- guard below refuses the owner rows among them, so the account delete fails
-- as a whole. Invariant 4 is about object storage, which Postgres knows
-- nothing about; it lives in `purgeBandStorage()`.)
--
-- ── Where ownership lives ────────────────────────────────────────────────────
--
-- As in `20260730_band_limit_enforcement.sql`: ownership in this schema is not
-- a column on `bands`, it is the row `band_members (band_id, user_id,
-- role = 'owner')`. A band with no such row is ownerless — it still exists,
-- still holds projects and tracks and R2 objects, still counts against nobody's
-- allowance, and no one can administer it or delete it. That is the state
-- invariant 3 exists to make unreachable.
--
-- ── Error signalling ─────────────────────────────────────────────────────────
--
-- Both guards raise a distinguishable SQLSTATE so the API layer can translate
-- them into the structured refusals it already returns, instead of letting a
-- generic 500 out:
--
--   BND01  band_not_empty            → 409 `{ error: 'band_not_empty', others }`
--   BND02  band_would_be_ownerless   → 400 `{ error: 'last_owner' }`
--
-- The constants are mirrored in `lib/bandDelete.ts` as `SQLSTATE_BAND_NOT_EMPTY`
-- and `SQLSTATE_BAND_OWNERLESS`; `sqlStateOf(err)` is what reads them. Both
-- classes are in the user-defined range (class `BN`), so they cannot collide
-- with a Postgres-defined SQLSTATE.
--
-- ── Which trigger fires when ─────────────────────────────────────────────────
--
-- This is the part worth being careful about, because the two legitimate
-- deletions both look, from inside `band_members`, exactly like the illegitimate
-- ones. The ordering that makes them distinguishable is Postgres's own:
--
--   `delete from bands where id = X`
--     1. BEFORE DELETE ON bands  → `guard_band_delete_requires_empty` fires.
--        The `bands` row and every `band_members` row are still present, so the
--        member count is the real one. This is the only moment at which the
--        count can be trusted, which is why invariant 1 is enforced here and
--        not on `band_members`.
--     2. The `bands` row is deleted.
--     3. The foreign key's ON DELETE CASCADE runs as an AFTER-ROW trigger on
--        `bands` and deletes the `band_members` rows — including the owner row.
--     4. AFTER DELETE ON band_members → `guard_band_member_delete_keeps_owner`
--        fires for the owner row. It looks for `bands.id = OLD.band_id` and
--        does not find it: step 2 already removed it. A band that no longer
--        exists cannot be ownerless, so the guard returns without raising.
--        **This is what keeps the legitimate cascade working.**
--
--   `delete from auth.users where id = U`  (or Supabase's admin delete-user)
--     1. The `auth.users` row is deleted; the cascade deletes the user's
--        `band_members` rows — owner rows among them.
--     2. AFTER DELETE ON band_members fires for each. For a band the user
--        merely belonged to, `OLD.role <> 'owner'` and the guard returns.
--        For a band the user OWNED, the `bands` row is still there (nothing
--        deleted it) and no other owner row remains, so the guard raises BND02
--        and the whole `delete from auth.users` rolls back.
--        **This is precisely how a band becomes ownerless today**, and it is
--        the case this file is mainly here to close. `DELETE /api/profile/
--        account` already refuses before it gets this far; this is the net
--        under the code, not a replacement for it.
--
--   `delete from band_members where band_id = X and user_id = M`  (remove member)
--     AFTER DELETE fires. If M was not the owner, the guard returns at the
--     first condition. If M was the owner and no other owner row remains, it
--     raises BND02 — which is the existing `last_owner` refusal in
--     `DELETE /api/bands/[id]/members/[userId]`, now also true at the storage
--     layer.
--
--   Transferring ownership
--     Insert (or promote) the new owner row FIRST, then delete the old one, in
--     the same transaction. At the moment the old row goes, another owner row
--     already exists, so the guard returns. The reverse order raises BND02.
--     Both triggers below are DEFERRABLE INITIALLY IMMEDIATE, so a maintenance
--     transaction that genuinely must reshuffle in the wrong order can
--     `SET CONSTRAINTS ALL DEFERRED` and be checked once at COMMIT instead of
--     per statement. That is an escape hatch for a human at a psql prompt, not
--     something the application should ever do.
--
-- ── Concurrency ──────────────────────────────────────────────────────────────
--
-- Guard 1 needs no explicit lock: it runs inside the DELETE that already holds
-- the `bands` row lock, and a concurrent INSERT of a new member would have to
-- take a FK reference on that same row. Guard 2 locks the `bands` row with
-- FOR UPDATE before counting owners — without it, two transactions could each
-- delete a different owner row of a two-owner band, each see the other's row as
-- still present, and both commit, turning a band with two owners into a band
-- with none. See the comment on that statement.
--
-- Deliberately NOT guarded: a band with more than one owner. The schema permits
-- it, `create_band_with_owner` never produces it, and turning it into an error
-- now would break any transfer flow that briefly holds two. The verification
-- queries at the bottom report it so you know whether it exists.

-- ─── 1. Invariant 1 — a band can only be deleted when it is empty ────────────

create or replace function public.guard_band_delete_requires_empty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_members integer;
begin
  -- Fires BEFORE the row is gone and BEFORE the cascade, so this count is the
  -- band's real membership. `for update` is not needed: the cascade in step 3
  -- will lock these rows, and a concurrent INSERT of a new member blocks on
  -- the same FK reference to a `bands` row this transaction is deleting.
  select count(*) into v_members
  from public.band_members
  where band_id = old.id;

  if v_members > 1 then
    raise exception 'band_not_empty'
      using errcode = 'BND01',
            detail  = format('band=%s members=%s', old.id, v_members),
            hint    = 'Remove the other members before deleting the space.';
  end if;

  return old;
end;
$$;

comment on function public.guard_band_delete_requires_empty() is
  'Invariant 1: refuses DELETE on a band that still has members besides the '
  'owner. Raises SQLSTATE BND01 (band_not_empty).';

drop trigger if exists trg_band_delete_requires_empty on public.bands;

create trigger trg_band_delete_requires_empty
  before delete on public.bands
  for each row
  execute function public.guard_band_delete_requires_empty();

-- ─── 2. Invariant 3 — a band can never become ownerless ──────────────────────

create or replace function public.guard_band_member_delete_keeps_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owners integer;
begin
  -- Losing a non-owner changes nothing about ownership.
  if old.role is distinct from 'owner' then
    return null;
  end if;

  -- Two jobs in one statement.
  --
  -- The existence check: if the band itself is being deleted, its
  -- `band_members` rows are going with it by cascade and the `bands` row is
  -- already gone (see the ordering note in the header) — `not found`, nothing
  -- to protect, return.
  --
  -- The lock: `for update` on the band row serialises every owner-row removal
  -- for that band. Without it two transactions could each delete a different
  -- owner row of a two-owner band, each still see the other's row, and both
  -- commit — leaving no owner. With it the second blocks until the first
  -- commits and then counts the truth. (The lock cannot deadlock against the
  -- band-delete path: that path's own DELETE takes the same row lock first and
  -- this guard returns above at `not found`.)
  --
  -- Note this is deliberately not `select count(*) ... for update`: Postgres
  -- rejects FOR UPDATE alongside an aggregate.
  perform 1 from public.bands where id = old.band_id for update;
  if not found then
    return null;
  end if;

  select count(*) into v_owners
  from public.band_members
  where band_id = old.band_id
    and role = 'owner';

  if v_owners = 0 then
    raise exception 'band_would_be_ownerless'
      using errcode = 'BND02',
            detail  = format('band=%s removed_owner=%s', old.band_id, old.user_id),
            hint    = 'Transfer ownership first, or delete the space instead.';
  end if;

  return null;
end;
$$;

comment on function public.guard_band_member_delete_keeps_owner() is
  'Invariant 3: refuses any DELETE that would leave a surviving band with no '
  'owner row — including the auth.users cascade. Raises SQLSTATE BND02 '
  '(band_would_be_ownerless). Returns early during a legitimate band cascade, '
  'when the bands row is already gone.';

drop trigger if exists trg_band_member_delete_keeps_owner on public.band_members;

-- A CONSTRAINT TRIGGER rather than a plain AFTER trigger, for the deferral
-- escape hatch described in the header. INITIALLY IMMEDIATE means it behaves
-- exactly like a plain AFTER ROW trigger unless somebody explicitly defers it.
create constraint trigger trg_band_member_delete_keeps_owner
  after delete on public.band_members
  deferrable initially immediate
  for each row
  execute function public.guard_band_member_delete_keeps_owner();

-- ─── Before you run this ─────────────────────────────────────────────────────
--
-- These are read-only. Run them FIRST, against production, and read the
-- results before applying anything above.
--
-- (a) Ownerless bands — bands that already violate invariant 3. The triggers
--     do not retroactively fix these; they only stop new ones. If this returns
--     rows, decide for each whether to assign an owner (promote a remaining
--     member) or delete the band, and note that deleting it will hit guard 1 if
--     it still has members.
--
--       select b.id, b.name, b.created_at,
--              (select count(*) from public.band_members m where m.band_id = b.id) as members
--       from public.bands b
--       where not exists (
--         select 1 from public.band_members m
--         where m.band_id = b.id and m.role = 'owner'
--       )
--       order by b.created_at;
--
-- (b) Multi-owner bands — permitted by the schema and not guarded, but you
--     should know whether any exist, because guard 2 lets the FIRST owner
--     removal through for these and only refuses the last one.
--
--       select band_id, count(*) as owners,
--              array_agg(user_id) as owner_ids
--       from public.band_members
--       where role = 'owner'
--       group by band_id
--       having count(*) > 1;
--
-- (c) Bands that could not be deleted today — owner plus at least one other
--     member. These are not broken; this is the count that guard 1 will refuse
--     on, and the number the owner is told to clear. Worth knowing the scale
--     before the refusal starts appearing in support tickets.
--
--       select count(*) as bands_with_other_members
--       from (
--         select band_id from public.band_members
--         group by band_id having count(*) > 1
--       ) t;
--
-- (d) `band_members` rows pointing at a band that no longer exists — should be
--     zero (the FK cascades), but if the FK was ever created without ON DELETE
--     CASCADE in some environment, guard 2's existence check would behave
--     differently there. Confirm the assumption holds.
--
--       select count(*) as orphan_memberships
--       from public.band_members m
--       where not exists (select 1 from public.bands b where b.id = m.band_id);
--
-- (e) Confirm the cascade the header relies on actually is a cascade:
--
--       select con.conname, con.confdeltype  -- expect 'c' (cascade)
--       from pg_constraint con
--       join pg_class rel on rel.oid = con.conrelid
--       where rel.relname = 'band_members' and con.contype = 'f';
--
-- ── After you run this ───────────────────────────────────────────────────────
--
-- Smoke-test in a transaction you roll back, against real data:
--
--       begin;
--       -- expect: ERROR ... band_not_empty ... SQLSTATE BND01
--       delete from public.bands where id = '<a band with 2+ members>';
--       rollback;
--
--       begin;
--       -- expect: success (owner-only band deletes, cascade included)
--       delete from public.bands where id = '<a band with only its owner>';
--       rollback;
--
--       begin;
--       -- expect: ERROR ... band_would_be_ownerless ... SQLSTATE BND02
--       delete from public.band_members
--       where band_id = '<any band>' and role = 'owner';
--       rollback;

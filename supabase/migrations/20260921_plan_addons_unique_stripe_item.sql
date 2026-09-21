-- ═══════════════════════════════════════════════════════════════════════════
-- B1 — make `plan_addons.stripe_subscription_item_id` usable as an ON CONFLICT
--      target.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ── The bug ────────────────────────────────────────────────────────────────
-- `20260920_billing_stripe.sql` created the uniqueness guarantee as a PARTIAL
-- unique index:
--
--   create unique index idx_plan_addons_stripe_item
--     on public.plan_addons (stripe_subscription_item_id)
--     where stripe_subscription_item_id is not null;
--
-- `syncAddonsFromSubscription()` (lib/billing/store.ts) upserts with
-- `onConflict: 'stripe_subscription_item_id'`. PostgREST compiles that to a
-- bare column list — `on conflict (stripe_subscription_item_id)` — and
-- Postgres will NOT infer a partial index from a bare column list: the
-- inference has to carry the same predicate (`where … is not null`), which
-- PostgREST has no way to express. Every call therefore raises
--
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Both callers of `syncAddonsFromSubscription` run AFTER the Stripe
-- subscription item exists, so the failure mode is the expensive one: the user
-- has been billed for the addon and no `plan_addons` row is ever created, so
-- the capacity they paid for is never granted.
--
-- ── The fix ────────────────────────────────────────────────────────────────
-- A plain (non-partial) UNIQUE constraint on the column. Postgres treats NULLs
-- as distinct under a plain UNIQUE (`nulls distinct` is the default), so the
-- many hand-granted rows with a NULL item id keep coexisting — which is the
-- only thing the `where … is not null` predicate was buying. The constraint is
-- inferable from a bare column list, so the upsert compiles and runs.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. VERIFY FIRST — run this before the rest of the file ═════════════════
--
-- Creating the constraint builds a unique index, and that build FAILS if two
-- rows already share a non-null `stripe_subscription_item_id`. The partial
-- index should have prevented exactly that, but it is worth one query: if the
-- index was ever dropped, rebuilt with `concurrently` and left invalid, or the
-- table was restored from a dump without it, duplicates can exist and the
-- statement below would abort the whole migration.
--
-- Expect ZERO rows. If it returns any, reconcile them first — keep the row the
-- live subscription item should point at (the one whose band_id / quantity
-- matches what Stripe currently bills) and delete the rest — then re-run this
-- query and continue only when it comes back empty.
--
--   select stripe_subscription_item_id,
--          count(*)                       as rows,
--          array_agg(id)                  as addon_ids,
--          array_agg(user_id)             as user_ids,
--          array_agg(addon_type)          as types,
--          array_agg(quantity)            as quantities
--     from public.plan_addons
--    where stripe_subscription_item_id is not null
--    group by stripe_subscription_item_id
--   having count(*) > 1;
--
-- While you are there, this should also be empty — a row pointing at an item
-- id that is not a Stripe subscription item id is a sign of a bad backfill:
--
--   select id, user_id, stripe_subscription_item_id
--     from public.plan_addons
--    where stripe_subscription_item_id is not null
--      and stripe_subscription_item_id not like 'si\_%';


-- ═══ 1. The constraint ══════════════════════════════════════════════════════
--
-- `add constraint … unique` is not idempotent on its own (no `if not exists`
-- for table constraints), so it is guarded by a catalog check.

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.plan_addons'::regclass
       and conname  = 'plan_addons_stripe_subscription_item_id_key'
  ) then
    alter table public.plan_addons
      add constraint plan_addons_stripe_subscription_item_id_key
      unique (stripe_subscription_item_id);
  end if;
end $$;


-- ═══ 2. Drop the partial index it replaces ══════════════════════════════════
--
-- Dropped only after the constraint exists, so the table is never without the
-- guarantee — not even for the length of this transaction. The constraint's
-- own index covers every read the old one did.

drop index if exists public.idx_plan_addons_stripe_item;


-- ═══ 3. Documentation ══════════════════════════════════════════════════════

comment on column public.plan_addons.stripe_subscription_item_id is
  'The Stripe subscription item that pays for this addon. NULL for addons '
  'granted by hand, which must keep working without any Stripe record. '
  'UNIQUE (nulls distinct): at most one row per Stripe item, unlimited '
  'hand-granted rows. Plain, NOT partial — PostgREST upserts name this column '
  'as a bare ON CONFLICT target and Postgres cannot infer a partial index '
  'from one (42P10).';


-- ═══ 4. Verify after ════════════════════════════════════════════════════════
--
-- Expect one row: contype 'u', and the definition WITHOUT a WHERE clause.
--
--   select c.conname, c.contype, pg_get_constraintdef(c.oid) as definition
--     from pg_constraint c
--    where c.conrelid = 'public.plan_addons'::regclass
--      and c.contype = 'u';
--
-- And the old index should be gone (expect zero rows):
--
--   select indexname from pg_indexes
--    where schemaname = 'public'
--      and indexname = 'idx_plan_addons_stripe_item';

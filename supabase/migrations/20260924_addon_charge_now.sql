-- ═══════════════════════════════════════════════════════════════════════════
-- Add-ons: charge at the moment of adding, remove at period end.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5), BEFORE
-- deploying the code that ships with it. Until it runs, every add-on
-- sync raises 42703/42P10 and the webhook answers 500 (Stripe retries, so
-- nothing is lost — but nothing lands either).
--
-- Idempotent: safe to run more than once.
--
-- ── What changed and why the schema has to follow ───────────────────────────
--
-- 1. ONE Stripe item per add-on PRICE, band split in metadata.
--    Stripe refuses two items with the same price on one subscription, so the
--    old "one item per (price, band)" model could never sell the same add-on
--    to a second band. The item now carries the total quantity and its
--    metadata records how many units each band holds. `plan_addons` therefore
--    needs one row per (item, band) — the plain UNIQUE on
--    `stripe_subscription_item_id` is replaced by UNIQUE on
--    `stripe_allocation_key` = '<item id>:<band id | *>'.
--
-- 2. Scheduled removals ("ending grants").
--    Removing an add-on drops it from Stripe at once with
--    `proration_behavior: 'none'` — so the renewal invoice can never bill it
--    and nothing is credited — while the capacity the user already paid for
--    is kept by a row with `ends_at` = end of the paid period. Those rows have
--    NO Stripe item id (a webhook sweep must never touch them) and stop
--    counting the moment `ends_at` passes, in the app (`readAddons`) and in
--    `effective_band_limit()` below alike.
--
-- 3. `billing_addon_orders` — one row per confirmed change. The payment
--    happens on a Stripe invoice created by a pending update; the grant
--    happens later, in the webhook, when that invoice is paid. The order is
--    what connects the two: which bands the new units go to (pending updates
--    cannot carry item metadata), which removals ride along, and what the
--    items looked like before, so applying it twice lands in the same place.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. plan_addons — allocation key, ending grants ═════════════════════════

alter table public.plan_addons
  add column if not exists stripe_allocation_key  text,
  add column if not exists ends_at                timestamptz,
  add column if not exists ending_subscription_id text;

-- Backfill: every existing Stripe-owned row becomes the allocation of its
-- item to its band (or to the account, '*', for extra_band).
update public.plan_addons
   set stripe_allocation_key =
         stripe_subscription_item_id || ':' || coalesce(band_id::text, '*')
 where stripe_subscription_item_id is not null
   and stripe_allocation_key is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.plan_addons'::regclass
       and conname  = 'plan_addons_stripe_allocation_key_key'
  ) then
    alter table public.plan_addons
      add constraint plan_addons_stripe_allocation_key_key
      unique (stripe_allocation_key);
  end if;
end $$;

-- Only after the new guarantee exists: the item id is no longer unique (two
-- bands can share one item).
alter table public.plan_addons
  drop constraint if exists plan_addons_stripe_subscription_item_id_key;
drop index if exists public.idx_plan_addons_stripe_item;

create index if not exists idx_plan_addons_stripe_item_id
  on public.plan_addons (stripe_subscription_item_id)
  where stripe_subscription_item_id is not null;

-- An ending grant is never Stripe-owned. Enforced, because a row with both
-- would be swept by a webhook the moment its item changed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.plan_addons'::regclass
       and conname  = 'plan_addons_ending_not_stripe_owned'
  ) then
    alter table public.plan_addons
      add constraint plan_addons_ending_not_stripe_owned
      check (ends_at is null or stripe_subscription_item_id is null);
  end if;
end $$;

create index if not exists idx_plan_addons_ending
  on public.plan_addons (user_id, ends_at)
  where ends_at is not null;

comment on column public.plan_addons.stripe_allocation_key is
  '<stripe item id>:<band id or *>. One row per band an item is split across. '
  'Also used as the idempotency key of an ending grant ("ending:<order>:…").';
comment on column public.plan_addons.ends_at is
  'Set only on a scheduled removal: the add-on is already gone from Stripe '
  '(nothing renews, nothing credited) and this row keeps the paid-for '
  'capacity until the end of the period. Ignored once in the past.';
comment on column public.plan_addons.ending_subscription_id is
  'The subscription whose paid period an ending grant runs out with.';


-- ═══ 2. effective_band_limit() — ignore expired ending grants ═══════════════
--
-- Body identical to 20260921_band_limit_override_floor.sql (floor semantics,
-- row lock, BL002, fail-closed plan fallback) plus ONE predicate on the addon
-- sum. Re-stated in full because `create or replace` has no partial form.
-- Mirrors `readAddons()` in lib/entitlements.ts — change both together.

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
  v_computed integer;
begin
  select p.plan, p.band_limit_override
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

  select l.bands_owned into v_base
    from public.plan_limits l
   where l.plan = coalesce(v_plan, 'free');

  if v_base is null then
    select l.bands_owned into v_base from public.plan_limits l where l.plan = 'free';
  end if;

  select coalesce(sum(a.quantity), 0)
    into v_addons
    from public.plan_addons a
   where a.user_id = p_user_id
     and a.addon_type = 'extra_band'
     and (a.ends_at is null or a.ends_at > now());

  v_computed := v_base + v_addons;

  return greatest(v_override, v_computed);
end;
$$;

revoke all on function public.effective_band_limit(uuid) from public, anon, authenticated;
grant execute on function public.effective_band_limit(uuid) to service_role;


-- ═══ 3. billing_addon_orders ════════════════════════════════════════════════

create table if not exists public.billing_addon_orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  subscription_id  text not null,
  -- The invoice the pending update created. NULL for a removals-only order,
  -- which moves no money and is applied on the spot.
  invoice_id       text unique,
  status           text not null default 'open'
                   check (status in ('open', 'requires_action', 'applied', 'failed', 'canceled')),
  -- [{ type, bandId, quantity }] — units bought (charged on invoice_id).
  buys             jsonb not null default '[]'::jsonb,
  -- [{ type, bandId, quantity }] — units scheduled to end at period end.
  removals         jsonb not null default '[]'::jsonb,
  -- { <price id>: { itemId, quantity, allocations: { <band id>: n } } } —
  -- the items as they were when the order was confirmed. Applying an order
  -- writes ABSOLUTE targets computed from this, so a retried webhook cannot
  -- allocate the same unit twice.
  items_before     jsonb not null default '{}'::jsonb,
  amount_due       integer,
  currency         text,
  proration_date   bigint,
  failure_reason   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  applied_at       timestamptz
);

-- ONE order in flight per user, enforced by the database. Two confirms from
-- a double click (or two tabs) would otherwise both reach Stripe — and if the
-- first had already been paid, the second would be a second charge.
create unique index if not exists idx_billing_addon_orders_one_open
  on public.billing_addon_orders (user_id)
  where status in ('open', 'requires_action');

create index if not exists idx_billing_addon_orders_subscription
  on public.billing_addon_orders (subscription_id, created_at desc);

alter table public.billing_addon_orders enable row level security;
-- No policies: service role only. The browser reads an order's status
-- through GET /api/billing/addons/orders/[id], never directly.

revoke all on public.billing_addon_orders from anon, authenticated;


-- ═══ 4. Verify after ════════════════════════════════════════════════════════
--
-- Every Stripe-owned row has a key, and keys are unique (the constraint says
-- so; this says the backfill reached everything):
--
--   select count(*) from public.plan_addons
--    where stripe_subscription_item_id is not null
--      and stripe_allocation_key is null;          -- expect 0
--
-- The resolver still agrees with itself for a few accounts:
--
--   select p.id, public.effective_band_limit(p.id)
--     from public.profiles p limit 5;

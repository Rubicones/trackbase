-- ═══════════════════════════════════════════════════════════════════════════
-- Billing — Stripe's side of the seam.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ── What this migration is, and what it deliberately is not ────────────────
-- The entitlement system already exists and already works: `profiles.plan`,
-- `plan_addons`, `profiles.grace_until`, and `lib/entitlements.ts` resolving
-- them. NOTHING in that system learns about Stripe. This migration adds the
-- bookkeeping Stripe needs and leaves the entitlement columns exactly where
-- they are, so the rule from `lib/plans.ts` survives intact:
--
--   ★ Stripe sets `profiles.plan` and inserts `plan_addons` rows. Nothing
--     downstream of that may read a Stripe id, a subscription status,
--     or a price. ★
--
-- So these tables are the *record of what was bought*, not the record of what
-- the user is entitled to. A support question ("why was I charged?") is
-- answered here; a limit check is answered by `lib/entitlements.ts` and never
-- touches these tables. If you find a guard joining `billing_subscriptions`,
-- that is the bug.
--
-- ── Why a subscription row at all, if plan is the truth? ───────────────────
-- Because the UI has to explain the difference between "you are on Band" and
-- "you are on Band, we could not charge your card on Tuesday, and we will try
-- again on Friday". The plan answers the first; only Stripe's status answers
-- the second, and a user staring at a payment-failed banner needs the second.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. billing_customers ═══════════════════════════════════════════════════
--
-- One Stripe Customer per user, forever. Creating a second one silently splits
-- a person's payment methods and invoice history across two records that no
-- screen ever joins, so the unique constraints below are load-bearing, not
-- hygiene: they turn a duplicate into an error instead of a mystery.

create table if not exists public.billing_customers (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id  text not null unique,
  created_at          timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

-- Readable by its owner so a client can tell "billing set up" from "never
-- paid". Writes are service-role only: a client that could write here could
-- point its user id at somebody else's Stripe customer.
drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own" on public.billing_customers
  for select using (auth.uid() = user_id);


-- ═══ 2. billing_subscriptions ═══════════════════════════════════════════════
--
-- The primary key is Stripe's subscription id, not a generated uuid. Webhooks
-- arrive out of order and more than once; keying on Stripe's own id makes the
-- write an upsert by construction rather than a read-then-decide.
--
-- `plan` is stored for display and support only. It is derived from the Price
-- id at write time and it is NOT what any limit check reads — that stays
-- `profiles.plan`, which the same webhook sets through `changePlan()` so the
-- grace period and band freezing run through the one code path.

create table if not exists public.billing_subscriptions (
  id                     text primary key,
  user_id                uuid not null references auth.users(id) on delete cascade,
  status                 text not null,
  -- Stripe's Price for the base plan item. The identity of what was bought:
  -- the webhook resolves the plan from this, never from editable metadata.
  price_id               text,
  -- Display copy of the resolved plan. Never read by an entitlement check.
  plan                   text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  -- Set while a payment is failing, so the dunning banner can say which
  -- attempt we are on and when the next one lands. Cleared on success.
  latest_invoice_id      text,
  payment_failed_at      timestamptz,
  next_payment_attempt   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_billing_subscriptions_user
  on public.billing_subscriptions (user_id);

-- Finding "the live one" is the most common read on this table, and a user can
-- legitimately have old canceled rows beside it.
create index if not exists idx_billing_subscriptions_live
  on public.billing_subscriptions (user_id, status)
  where status in ('trialing', 'active', 'past_due', 'unpaid', 'incomplete');

alter table public.billing_subscriptions enable row level security;

drop policy if exists "billing_subscriptions_select_own" on public.billing_subscriptions;
create policy "billing_subscriptions_select_own" on public.billing_subscriptions
  for select using (auth.uid() = user_id);


-- ═══ 3. billing_events — webhook idempotency ════════════════════════════════
--
-- Stripe retries a webhook until it gets a 2xx, and it is explicit that an
-- event may be delivered more than once. Every handler here is written to be
-- idempotent on its own, but "written to be" is not a guarantee, and the one
-- that isn't would double-insert an addon and hand out capacity nobody paid
-- for. The insert below is the guard: it fails on a duplicate id, and the
-- handler treats that failure as "already done".

create table if not exists public.billing_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

alter table public.billing_events enable row level security;
-- No policy at all: nothing but the service role has any business reading this.


-- ═══ 4. plan_addons — the Stripe link ═══════════════════════════════════════
--
-- Addons keep living in the table the entitlement resolver already reads. All
-- that is added is the link back to the subscription item that pays for them,
-- so a removal in Stripe can find the row it corresponds to.
--
-- Both columns are nullable on purpose: rows granted by hand (a support
-- credit, a grandfathered account) have no Stripe item and must keep working.

alter table public.plan_addons
  add column if not exists stripe_subscription_item_id text,
  add column if not exists stripe_price_id text;

-- One addon row per subscription item. Without this a retried webhook can add
-- the same purchased addon twice, which is capacity granted for free.
create unique index if not exists idx_plan_addons_stripe_item
  on public.plan_addons (stripe_subscription_item_id)
  where stripe_subscription_item_id is not null;

comment on column public.plan_addons.stripe_subscription_item_id is
  'The Stripe subscription item that pays for this addon. NULL for addons '
  'granted by hand, which must keep working without any Stripe record.';


-- ═══ 5. updated_at ══════════════════════════════════════════════════════════

create or replace function public.touch_billing_subscription()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_billing_subscription on public.billing_subscriptions;
create trigger trg_touch_billing_subscription
  before update on public.billing_subscriptions
  for each row execute function public.touch_billing_subscription();

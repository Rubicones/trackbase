-- ═══════════════════════════════════════════════════════════════════════════
-- Drop the abandoned first-draft Stripe schema.
--
-- ⚠ RUN THIS MANUALLY in the Supabase SQL editor (AGENTS.md §5).
--
-- ── What this removes, and why it is dead ──────────────────────────────────
-- An earlier plan for billing put Stripe's identifiers directly on `profiles`
-- and logged events in a `stripe_events` table. That plan was replaced before
-- any code was written against it: `20260920_billing_stripe.sql` put the same
-- facts in dedicated tables instead — `billing_customers`,
-- `billing_subscriptions`, `billing_events` — so that `profiles` stays the
-- entitlement table and nothing downstream of the webhook can accidentally
-- read a Stripe id off it. That separation is a stated rule
-- (AGENTS.md §4: "`lib/entitlements.ts`, `lib/plans.ts` and
-- `lib/planGuards.ts` contain the string 'stripe' zero times and must keep
-- doing so"), and a `profiles.stripe_customer_id` sitting there is an
-- invitation to break it.
--
-- The three objects dropped here were created by hand and were never wired to
-- anything:
--
--   profiles.stripe_customer_id       superseded by billing_customers
--                                       .stripe_customer_id
--   profiles.stripe_subscription_id   superseded by billing_subscriptions.id
--   stripe_events                     superseded by billing_events
--
-- ── How that was established ───────────────────────────────────────────────
-- Searched the whole repository (excluding node_modules and the .next build
-- output) on 2026-09-21:
--
--   · `stripe_subscription_id`  — zero occurrences anywhere.
--   · `stripe_events`           — zero occurrences anywhere.
--   · `stripe_customer_id`      — every occurrence is on `billing_customers`
--     (lib/billing/store.ts readCustomerId / getOrCreateStripeCustomer /
--     userIdForCustomer, and the column definition in
--     20260920_billing_stripe.sql). None is on `profiles`.
--
-- And from the other direction: every `.from('profiles')` call in the
-- codebase names its columns explicitly — there is no `select('*')` on
-- profiles anywhere — and no such list and no `.update()` payload mentions a
-- Stripe column. The only file that touches both Stripe and `profiles` is
-- `app/api/profile/account/route.ts`, which reads `username`.
--
-- ── Deliberately not CASCADE ───────────────────────────────────────────────
-- A plain `drop column` takes that column's own indexes and constraints with
-- it, but ERRORS if a view, policy or generated column depends on it. That is
-- the behaviour we want: the sweep above covered application code, not
-- database objects created by the same hand-written SQL. If this migration
-- fails with a dependency error, do NOT add CASCADE — read what the dependent
-- object is first, since it is something nobody in this repo knows about.
--
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 0. VERIFY FIRST — that there is nothing to lose ═══════════════════════
--
-- These are reported to be empty in production. The guards in section 1 check
-- it again at run time and abort rather than take your word for it, but it is
-- worth seeing the numbers yourself. All three expect 0.
--
--   select count(*) filter (where stripe_customer_id is not null)     as customer_ids,
--          count(*) filter (where stripe_subscription_id is not null) as subscription_ids
--     from public.profiles;
--
--   select count(*) as stripe_event_rows from public.stripe_events;
--
-- If any of them is non-zero, STOP. A non-null value means something wrote it,
-- which contradicts the sweep above, and the first thing to find out is what.


-- ═══ 1. profiles: the two abandoned columns ════════════════════════════════
--
-- Each drop is guarded on its own so that a surprise in one does not hide the
-- other, and so the error names the column.

do $$
declare
  v_rows bigint;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'stripe_customer_id'
  ) then
    execute 'select count(*) from public.profiles where stripe_customer_id is not null'
       into v_rows;

    if v_rows > 0 then
      raise exception
        'profiles.stripe_customer_id holds % non-null value(s); refusing to drop it. '
        'Something wrote this column. Find out what before dropping.', v_rows;
    end if;

    alter table public.profiles drop column stripe_customer_id;
    raise notice 'dropped profiles.stripe_customer_id';
  else
    raise notice 'profiles.stripe_customer_id already absent, skipping';
  end if;
end $$;

do $$
declare
  v_rows bigint;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'stripe_subscription_id'
  ) then
    execute 'select count(*) from public.profiles where stripe_subscription_id is not null'
       into v_rows;

    if v_rows > 0 then
      raise exception
        'profiles.stripe_subscription_id holds % non-null value(s); refusing to drop it. '
        'Something wrote this column. Find out what before dropping.', v_rows;
    end if;

    alter table public.profiles drop column stripe_subscription_id;
    raise notice 'dropped profiles.stripe_subscription_id';
  else
    raise notice 'profiles.stripe_subscription_id already absent, skipping';
  end if;
end $$;


-- ═══ 2. stripe_events ══════════════════════════════════════════════════════
--
-- `billing_events` does this job now: same purpose (webhook idempotency), and
-- the handler in app/api/stripe/webhook/route.ts claims every event against
-- it. Nothing has ever read or written `stripe_events`.

do $$
declare
  v_rows bigint;
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'stripe_events'
  ) then
    execute 'select count(*) from public.stripe_events' into v_rows;

    if v_rows > 0 then
      raise exception
        'public.stripe_events holds % row(s); refusing to drop it. Something '
        'wrote this table. Find out what before dropping.', v_rows;
    end if;

    -- RESTRICT (the default) on purpose — see the header.
    drop table public.stripe_events;
    raise notice 'dropped public.stripe_events';
  else
    raise notice 'public.stripe_events already absent, skipping';
  end if;
end $$;


-- ═══ 3. Verify after ════════════════════════════════════════════════════════
--
-- Expect zero rows from both.
--
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name   = 'profiles'
--      and column_name in ('stripe_customer_id', 'stripe_subscription_id');
--
--   select table_name
--     from information_schema.tables
--    where table_schema = 'public' and table_name = 'stripe_events';
--
-- And the surviving billing schema should be untouched — expect all three:
--
--   select table_name
--     from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('billing_customers', 'billing_subscriptions', 'billing_events')
--    order by table_name;

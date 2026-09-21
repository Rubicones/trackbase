/**
 * Everything the database knows about Stripe.
 *
 * ⚠ SERVER ONLY.
 *
 * This module is the *only* place that reads or writes `billing_customers`,
 * `billing_subscriptions` and `billing_events`, and the only place that links
 * a `plan_addons` row to a Stripe subscription item. Keeping it in one file is
 * what lets `lib/entitlements.ts` stay ignorant of Stripe entirely — the rule
 * the whole plan system is built around.
 *
 * Nothing here decides an entitlement. `subscriptionGrantsPlan()` answers
 * "what did they pay for", and the webhook passes that answer to
 * `changePlan()`, which owns the consequences: conflicts, the grace period and
 * band freezing. A limit check never reaches this file.
 */

import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { stripeClient } from '@/lib/billing/stripe'
import { addonForPriceId, planForPriceId, BILLING_LIVE } from '@/lib/billing/config'
import { ADDONS, DEFAULT_PLAN, isAddonType, type AddonType, type PlanId } from '@/lib/plans'

// ── Statuses ─────────────────────────────────────────────────────────────────

/**
 * Subscriptions worth showing on a billing screen: the one a user would call
 * "my subscription", including the unhappy ones.
 */
export const LIVE_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
] as const

/**
 * Statuses that still entitle the user to the plan they bought.
 *
 * `past_due` is deliberately included. Stripe is still retrying the card, the
 * user has not cancelled anything, and yanking a band's features away — or
 * freezing bands — on the first failed retry would punish a expired card with
 * data loss-shaped consequences. They keep the plan while Stripe retries; when
 * Stripe gives up the status becomes `unpaid` or `canceled` and this returns
 * false, at which point the ordinary downgrade path takes over with its own
 * 14-day grace period on top.
 */
const ENTITLING_STATUSES = new Set(['trialing', 'active', 'past_due'])

export function statusEntitles(status: string): boolean {
  return ENTITLING_STATUSES.has(status)
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface BillingSubscriptionRow {
  id: string
  userId: string
  status: string
  priceId: string | null
  plan: PlanId | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  latestInvoiceId: string | null
  paymentFailedAt: string | null
  nextPaymentAttempt: string | null
}

function toRow(raw: Record<string, unknown>): BillingSubscriptionRow {
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    status: String(raw.status),
    priceId: typeof raw.price_id === 'string' ? raw.price_id : null,
    plan: typeof raw.plan === 'string' ? (raw.plan as PlanId) : null,
    currentPeriodEnd: typeof raw.current_period_end === 'string' ? raw.current_period_end : null,
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    canceledAt: typeof raw.canceled_at === 'string' ? raw.canceled_at : null,
    latestInvoiceId: typeof raw.latest_invoice_id === 'string' ? raw.latest_invoice_id : null,
    paymentFailedAt: typeof raw.payment_failed_at === 'string' ? raw.payment_failed_at : null,
    nextPaymentAttempt:
      typeof raw.next_payment_attempt === 'string' ? raw.next_payment_attempt : null,
  }
}

/**
 * The selection rule, on its own so it can be stated once and tested.
 *
 * The authoritative subscription is the most recent one in an ENTITLING
 * status; only when the user has none is it the most recent LIVE one. `rows`
 * must already be ordered newest-first.
 *
 * Recency alone is not the rule, and the difference is what keeps a paying
 * account paid-for. `LIVE_STATUSES` deliberately includes statuses that
 * entitle nothing (`incomplete`, `unpaid`) — a subscription being paid for
 * and one whose first payment never cleared are both "theirs" on a billing
 * screen. Ordered by recency alone the newer non-entitling row wins, so a
 * failed 3DS attempt, or a second subscription gone `unpaid`, becomes the
 * answer to "which subscription is theirs"; the webhook then resolves it
 * through `subscriptionGrantsPlan()` to `free` and downgrades an account that
 * is still being charged — grace period armed, bands eventually frozen.
 *
 * Stating it here rather than in a guard at each call site is the point: this
 * function is what defines "which subscription is theirs", so every caller
 * — the webhook, the billing screen, the addons route, the checkout guard —
 * inherits the invariant instead of re-deriving it.
 */
export function authoritativeRow<T extends { status: string }>(rows: T[]): T | null {
  if (!rows.length) return null
  return rows.find((row) => statusEntitles(row.status)) ?? rows[0]
}

/**
 * The subscription that is authoritative for this user — see
 * `authoritativeRow()` for the rule. Null when the user has never subscribed,
 * or when every subscription they had has ended.
 *
 * ── "Most recent" ────────────────────────────────────────────────────────────
 * Ordered by our own `created_at`: the moment we first mirrored the row, not
 * the moment Stripe created the subscription. Stripe guarantees no ordering
 * between webhooks, so a late-delivered `created` writes a row whose
 * `created_at` is newer than a subscription Stripe actually created after it.
 * Switch this to Stripe's own `created` timestamp when the residual-N6
 * migration adds the column — same reason as that fix. Until then the tie is
 * resolved by delivery order, which is right in every ordinary case and wrong
 * only for two subscriptions created close enough together to be reordered in
 * flight. Note the entitling-first rule already absorbs the case that
 * mattered: a misordered `incomplete` cannot win over an `active` whatever
 * the timestamps say.
 */
export async function readLiveSubscription(
  userId: string,
): Promise<BillingSubscriptionRow | null> {
  // Deliberately no `.limit(1)`: the rule has to see the entitling rows
  // sitting behind a newer non-entitling one. The filter is one user's live
  // subscriptions — `idx_billing_subscriptions_live` covers exactly this
  // predicate, and the row count is single digits for any real account.
  const { data, error } = await supabase
    .from('billing_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', LIVE_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })

  // The billing tables ship before the migration is applied by hand
  // (AGENTS.md §5). Absent tables mean "nobody has ever paid", which is the
  // truth in that state — not an error worth taking a page down for.
  if (error) return null
  const rows = (data ?? []) as Record<string, unknown>[]
  const chosen = authoritativeRow(rows.map((raw) => ({ raw, status: String(raw.status) })))
  return chosen ? toRow(chosen.raw) : null
}

// ── Customers ────────────────────────────────────────────────────────────────

async function accountEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error) return null
  return data?.user?.email ?? null
}

export async function readCustomerId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  const id = (data as { stripe_customer_id?: unknown } | null)?.stripe_customer_id
  return typeof id === 'string' ? id : null
}

/**
 * The user's Stripe Customer, created on first need.
 *
 * One customer per user, forever: a second one silently splits payment methods
 * and invoice history across two records no screen ever joins. The insert is
 * therefore an upsert on the primary key, and a lost race re-reads rather than
 * creating a rival customer.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const existing = await readCustomerId(userId)
  if (existing) return existing

  const email = await accountEmail(userId)
  const customer = await stripeClient().customers.create({
    email: email ?? undefined,
    // The only identifier Stripe needs from us. Never the email as identity:
    // people change it, and the user id is what every webhook resolves back to.
    metadata: { supabase_user_id: userId },
  })

  const { error } = await supabase
    .from('billing_customers')
    .insert({ user_id: userId, stripe_customer_id: customer.id })

  if (error) {
    // Someone else won the race. Their customer is the real one; ours is an
    // orphan with no subscription attached, which is harmless and visible in
    // the dashboard. Returning theirs is what keeps the invariant true.
    const raced = await readCustomerId(userId)
    if (raced) return raced
    throw error
  }

  return customer.id
}

/**
 * The customer's entitling subscription **according to Stripe**, or null.
 *
 * ── Why not `readLiveSubscription()` ────────────────────────────────────────
 * That one reads `billing_subscriptions`, which is a mirror, and a mirror is
 * exactly as current as the last webhook that landed. For a display screen
 * that is fine. For the question "may this user start a NEW subscription" it
 * is not, and the failure is not hypothetical: with the webhook broken, the
 * mirror stays empty, the guard sees "never subscribed", and a user who pays
 * twice because the page never updated ends up with two active subscriptions
 * on one customer — the second one invisible to every screen in this app and
 * billing forever.
 *
 * The guard must not depend on the mechanism whose failure creates the
 * situation it guards against. So this asks the ledger. Same reasoning, and
 * the same shape, as `cancelSubscriptionsForAccountDeletion`.
 *
 * FAILS CLOSED on more subscriptions than one page holds: a short answer here
 * means "you have none", which is the answer that creates a duplicate.
 *
 * Among entitling subscriptions the newest wins, by **Stripe's** `created`
 * rather than our `created_at` — Stripe orders its own objects correctly, and
 * webhook delivery order does not.
 */
export async function findEntitlingSubscription(
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const all = await stripeClient().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })

  if (all.has_more) {
    throw new Error(
      `Stripe customer ${customerId} has more than 100 subscriptions; ` +
        'refusing to answer whether one of them entitles a plan.',
    )
  }

  const entitling = all.data
    .filter(sub => statusEntitles(sub.status))
    .sort((a, b) => b.created - a.created)

  return entitling[0] ?? null
}

/** Resolve our user from a Stripe customer, without trusting client input. */
export async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('billing_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (error) return null
  const id = (data as { user_id?: unknown } | null)?.user_id
  return typeof id === 'string' ? id : null
}

// ── Subscriptions ────────────────────────────────────────────────────────────

function isoOrNull(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null
}

/** The item that represents the plan itself, as opposed to an addon. */
export function basePlanItem(sub: Stripe.Subscription): Stripe.SubscriptionItem | null {
  for (const item of sub.items.data) {
    if (planForPriceId(item.price?.id)) return item
  }
  return null
}

/**
 * What plan this subscription currently grants.
 *
 * Resolved from the Price id, never from metadata: metadata is editable by
 * anyone with dashboard access, and a typo there would hand out entitlements.
 * A subscription in a status that no longer entitles anything resolves to the
 * default (free) so the caller downgrades through the normal path.
 */
export function subscriptionGrantsPlan(sub: Stripe.Subscription): PlanId {
  if (!statusEntitles(sub.status)) return DEFAULT_PLAN
  const item = basePlanItem(sub)
  return planForPriceId(item?.price?.id) ?? DEFAULT_PLAN
}

/**
 * Mirror a Stripe subscription into our bookkeeping.
 *
 * Keyed on Stripe's own id, so an out-of-order or repeated webhook overwrites
 * rather than duplicates. This writes nothing that an entitlement check reads.
 */
export async function upsertSubscription(
  userId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const item = basePlanItem(sub)
  const periodEnd =
    isoOrNull((sub as unknown as { current_period_end?: number }).current_period_end) ??
    isoOrNull((item as unknown as { current_period_end?: number } | null)?.current_period_end)

  const { error } = await supabase.from('billing_subscriptions').upsert(
    {
      id: sub.id,
      user_id: userId,
      status: sub.status,
      price_id: item?.price?.id ?? null,
      plan: planForPriceId(item?.price?.id),
      current_period_end: periodEnd,
      cancel_at_period_end: sub.cancel_at_period_end === true,
      canceled_at: isoOrNull(sub.canceled_at),
    },
    { onConflict: 'id' },
  )
  if (error) throw error
}

/**
 * Statuses a subscription can no longer be cancelled FROM — it is already
 * over. Calling `subscriptions.cancel` on one of these is an error from
 * Stripe, not a no-op.
 */
const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired'])

/**
 * Cancel every subscription this user still has, immediately.
 *
 * Called on account deletion, and nowhere else. Deleting the auth user
 * cascades `billing_customers` away, and with it the only
 * `stripe_customer_id → user_id` link there is. The subscription itself lives
 * in Stripe and knows nothing about that: it keeps renewing, the card keeps
 * being charged, and every resulting webhook resolves to no user, gets logged
 * and dropped. The customer is then charged indefinitely with nothing in this
 * system connecting the charge to a person — not a support ticket anyone can
 * answer, and not a refund anyone can trace.
 *
 * ── Why it asks Stripe rather than our own table ────────────────────────────
 * `billing_subscriptions` is a mirror, and a mirror can be behind: a
 * subscription created while the webhook endpoint was down, or during the
 * window before the billing migration was applied, exists in Stripe and not
 * here. Cancelling from our copy would leave exactly those charging. Stripe is
 * the ledger; this reads it.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It does not delete the Stripe Customer. Invoices already issued are
 * accounting records and must survive the account they belonged to — Stripe
 * keeps them against the customer, and a `metadata.supabase_user_id` that no
 * longer resolves is still the trail back to what happened.
 *
 * THROWS on any Stripe failure. The caller must treat that as fatal and
 * abandon the deletion: an account that cannot be deleted today is a support
 * request, and a deleted account that keeps being charged is not recoverable
 * from this side at all.
 */
export async function cancelSubscriptionsForAccountDeletion(userId: string): Promise<void> {
  // No keys means no subscription was ever created from this deployment and
  // no card can be charged by it. Nothing to cancel, and `stripeClient()`
  // would throw `BillingNotConfiguredError` on a path where that would block
  // a deletion for no reason.
  if (!BILLING_LIVE) return

  const customerId = await readCustomerId(userId)
  if (!customerId) return

  const stripe = stripeClient()

  // 100 is Stripe's page maximum and far beyond anything this app creates —
  // one base subscription plus addon items on it. Not paginated on purpose:
  // if an account ever did hold more, silently cancelling the first hundred
  // and reporting success is the failure this function exists to prevent.
  const existing = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })

  if (existing.has_more) {
    throw new Error(
      `Stripe customer ${customerId} has more than 100 subscriptions; ` +
        'refusing to delete the account without cancelling all of them.',
    )
  }

  for (const sub of existing.data) {
    if (TERMINAL_STATUSES.has(sub.status)) continue
    // Immediate, not `cancel_at_period_end`: the account is going away now,
    // and a subscription set to lapse later would still renew-then-lapse with
    // nobody left to attribute it to.
    await stripe.subscriptions.cancel(sub.id)
  }
}

export async function recordPaymentFailure(
  subscriptionId: string,
  invoiceId: string | null,
  nextAttempt: number | null,
): Promise<void> {
  await supabase
    .from('billing_subscriptions')
    .update({
      latest_invoice_id: invoiceId,
      payment_failed_at: new Date().toISOString(),
      next_payment_attempt: isoOrNull(nextAttempt),
    })
    .eq('id', subscriptionId)
}

export async function clearPaymentFailure(subscriptionId: string): Promise<void> {
  await supabase
    .from('billing_subscriptions')
    .update({ payment_failed_at: null, next_payment_attempt: null })
    .eq('id', subscriptionId)
}

// ── Addons ───────────────────────────────────────────────────────────────────

/**
 * The band a band-scoped addon item is attached to.
 *
 * Carried in the subscription item's metadata because that is the only place
 * Stripe will keep it. It is checked against real ownership before it is
 * honoured — the worst a tampered value can do is move capacity between bands
 * the same user already owns, and even that is refused below.
 */
async function ownedBandId(userId: string, value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null
  const { data } = await supabase
    .from('band_members')
    .select('band_id')
    .eq('band_id', value)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle()
  return data ? value : null
}

/**
 * Reconcile `plan_addons` against what the subscription actually contains.
 *
 * Rows that came from Stripe are owned by Stripe: an item that is gone means
 * the addon is gone. Rows granted by hand have no `stripe_subscription_item_id`
 * and are never touched here — support credits and grandfathered capacity must
 * survive every webhook.
 */
export async function syncAddonsFromSubscription(
  userId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  const seen = new Set<string>()

  for (const item of sub.items.data) {
    const type = addonForPriceId(item.price?.id)
    if (!type || !isAddonType(type)) continue

    const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 0
    if (quantity === 0) continue

    const bandId = await resolveAddonBand(userId, type, item)
    // A band-scoped addon with no band it can legitimately land on is dropped
    // rather than applied account-wide: storage is never pooled, and guessing
    // a band would hand capacity to whichever one sorted first.
    if (type !== 'extra_band' && !bandId) continue

    seen.add(item.id)

    const { error } = await supabase.from('plan_addons').upsert(
      {
        user_id: userId,
        band_id: type === 'extra_band' ? null : bandId,
        addon_type: type,
        quantity,
        stripe_subscription_item_id: item.id,
        stripe_price_id: item.price?.id ?? null,
      },
      { onConflict: 'stripe_subscription_item_id' },
    )
    if (error) throw error
  }

  // ── Remove Stripe-owned rows this subscription no longer contains ─────────
  //
  // ⚠ The sweep is scoped to ONE subscription, and that scoping is the whole
  // point. It used to select every Stripe-owned row belonging to the user and
  // delete any whose item id was not in `seen` — but `seen` is built from the
  // items of the subscription being synced. A user can hold more than one live
  // subscription (a second checkout stuck on 3DS leaves an `incomplete`; a
  // resubscribe can overlap the old subscription's `deleted` event), and any
  // webhook for subscription A would then delete subscription B's add-on rows.
  // Capacity the user is still being billed for disappeared until a webhook for
  // B happened to arrive.
  //
  // `plan_addons` does not record WHICH subscription an item came from — only
  // the item id — so the set of item ids that must survive is assembled from
  // Stripe: this subscription's items, plus every item on every other
  // subscription this customer has. A row is stale only when its item belongs
  // to none of them.
  const candidates = await staleAddonCandidates(userId, seen)
  if (!candidates.length) return

  const protectedItemIds = await liveItemIdsForCustomer(sub)
  const stale = candidates
    .filter(row => !protectedItemIds.has(row.stripe_subscription_item_id))
    .map(row => row.id)

  if (stale.length) {
    await supabase.from('plan_addons').delete().in('id', stale)
  }
}

/**
 * Stop billing for the add-ons attached to a band that is about to be deleted.
 *
 * `plan_addons.band_id` cascades on band delete, so the ROW disappears the
 * moment the band does — but the Stripe subscription item it came from is
 * untouched and keeps charging, every month, forever. Nothing in the app can
 * show it afterwards either: the next webhook cannot resolve the dead band, so
 * `syncAddonsFromSubscription` skips the item, and the row it would have
 * matched is already gone, so the sweep has nothing to remove. The charge
 * becomes invisible from inside the product and the user has no way to find
 * it except on a card statement.
 *
 * ── Removed, not re-scoped ──────────────────────────────────────────────────
 * The other option was moving the item to another band the user owns. That
 * spends money on their behalf, on a band they did not choose, at the moment
 * they asked for something to be deleted. Removing it is the reading of
 * "delete this band" that does not surprise anyone, and buying it again is one
 * click on the billing page.
 *
 * Proration is explicit rather than left to the account default: the unused
 * part of the period is credited against the next invoice, which is what makes
 * this a cancellation rather than a forfeit.
 *
 * ── THROWS ──────────────────────────────────────────────────────────────────
 * Every failure throws, and the caller must abandon the band deletion. Same
 * principle as account deletion (`cancelSubscriptionsForAccountDeletion`): a
 * deletion the user has to retry is an annoyance, a subscription item billing
 * for a band that no longer exists is not recoverable from this side at all.
 * An item Stripe reports as already gone is success — the goal is that it is
 * not billing, not that we were the one to remove it.
 *
 * Returns how many items were removed; zero for the ordinary band, which does
 * not touch Stripe at all.
 */
export async function removeBandScopedAddonItems(bandId: string): Promise<number> {
  // No keys means nothing was ever charged from this deployment, and
  // `stripeClient()` would throw and block a deletion for no reason.
  if (!BILLING_LIVE) return 0

  // The addon types are derived from the catalog rather than listed here, so
  // a band-scoped addon added to `lib/plans.ts` later is covered without
  // anyone remembering this file. `band_id` alone would in fact be enough —
  // account-wide addons never carry one — but the two agreeing is the check.
  const bandScopedTypes = (Object.keys(ADDONS) as AddonType[]).filter(
    type => ADDONS[type].bandScoped,
  )

  const { data, error } = await supabase
    .from('plan_addons')
    .select('stripe_subscription_item_id')
    .eq('band_id', bandId)
    .in('addon_type', bandScopedTypes)
    .not('stripe_subscription_item_id', 'is', null)

  // A read failure is NOT "no add-ons": treating it that way is how the band
  // gets deleted with the item still billing.
  if (error) throw error

  const itemIds = Array.from(
    new Set(
      (data ?? [])
        .map(row => (row as { stripe_subscription_item_id: string }).stripe_subscription_item_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  if (!itemIds.length) return 0

  const stripe = stripeClient()
  let removed = 0

  for (const itemId of itemIds) {
    try {
      await stripe.subscriptionItems.del(itemId, { proration_behavior: 'create_prorations' })
      removed += 1
    } catch (err) {
      // Already deleted in the dashboard, or on a subscription that has since
      // been cancelled: the item is not billing, which is the whole objective.
      if (isStripeResourceMissing(err)) continue
      throw err
    }
  }

  return removed
}

/** Stripe's "this object no longer exists" — the one failure that is a success here. */
function isStripeResourceMissing(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; statusCode?: unknown }
  return e.code === 'resource_missing' || e.statusCode === 404
}

interface StaleCandidate {
  id: string
  stripe_subscription_item_id: string
}

/**
 * Stripe-owned rows for this user whose item was not just re-stated from the
 * subscription being synced. These are only *candidates* — see the caller.
 */
async function staleAddonCandidates(
  userId: string,
  seen: Set<string>,
): Promise<StaleCandidate[]> {
  const { data } = await supabase
    .from('plan_addons')
    .select('id, stripe_subscription_item_id')
    .eq('user_id', userId)
    .not('stripe_subscription_item_id', 'is', null)

  return ((data ?? []) as StaleCandidate[]).filter(
    row => !seen.has(row.stripe_subscription_item_id),
  )
}

/**
 * Every subscription item id currently attached to this subscription's
 * customer, across all of their subscriptions.
 *
 * FAILS CLOSED. If the customer cannot be read, or Stripe reports more
 * subscriptions than one page holds, this throws rather than returning a
 * partial set — a short answer here means deleting rows that should have
 * survived, which is paid-for capacity. The caller is a webhook handler: a
 * throw releases the event claim and Stripe retries, where a silent partial
 * sweep would not be noticed at all.
 */
async function liveItemIdsForCustomer(sub: Stripe.Subscription): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const item of sub.items.data) ids.add(item.id)

  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null
  if (!customerId) {
    throw new Error(
      `subscription ${sub.id} has no resolvable customer; refusing to sweep add-ons`,
    )
  }

  // 100 is Stripe's page maximum and far beyond anything this app creates.
  const all = await stripeClient().subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })
  if (all.has_more) {
    throw new Error(
      `Stripe customer ${customerId} has more than 100 subscriptions; ` +
        'refusing to sweep add-ons without seeing all of them.',
    )
  }

  for (const other of all.data) {
    for (const item of other.items.data) ids.add(item.id)
  }

  return ids
}

async function resolveAddonBand(
  userId: string,
  type: AddonType,
  item: Stripe.SubscriptionItem,
): Promise<string | null> {
  if (type === 'extra_band') return null
  return ownedBandId(userId, item.metadata?.band_id)
}

// ── Idempotency ──────────────────────────────────────────────────────────────

/**
 * Claim a webhook event. False means it has already been handled.
 *
 * Stripe is explicit that an event may be delivered more than once, and it
 * retries until it gets a 2xx. Every handler here is written to be idempotent
 * on its own; this is the backstop for the one that isn't, because the failure
 * mode — a second addon row — is capacity nobody paid for.
 */
export async function claimEvent(eventId: string, type: string): Promise<boolean> {
  const { error } = await supabase
    .from('billing_events')
    .insert({ id: eventId, type })

  if (!error) return true
  // 23505 = unique violation: we have seen this event before.
  if ((error as { code?: string }).code === '23505') return false
  // Anything else (the table is missing, the database is unhappy) must not
  // swallow the event — let the handler run and let Stripe retry on a throw.
  console.warn('[billing] could not claim event', eventId, error)
  return true
}

/**
 * Give an event back after a failed handler.
 *
 * Claiming before handling is what makes a duplicate delivery cheap, but it
 * also means a handler that throws has already marked the event as done — and
 * Stripe's retry would then be skipped, silently, forever. Releasing the claim
 * on the way out of a failure is what keeps the retry meaningful.
 */
export async function releaseEvent(eventId: string): Promise<void> {
  await supabase.from('billing_events').delete().eq('id', eventId)
}

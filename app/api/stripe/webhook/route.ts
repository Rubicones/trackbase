/**
 * POST /api/stripe/webhook — the only place a plan is ever sold.
 *
 * ★ THIS HANDLER IS THE SEAM. ★
 *
 * `lib/plans.ts` has carried one rule since the entitlement system was
 * written: Stripe sets `profiles.plan` and inserts `plan_addons` rows, and
 * nothing downstream of that reads a Stripe id, a status or a price. This file
 * is the "Stripe" in that sentence, and it is the only file in the app that
 * may write a plan outside `next dev`. `POST /api/me/plan` stays dev-gated
 * exactly as it was; an open self-serve plan endpoint would be a one-request
 * grant of `band_plus` to anyone with a session.
 *
 * ── Why it goes through changePlan() ────────────────────────────────────────
 * Because a plan change has consequences that live nowhere near Stripe:
 * structural conflicts, the 14-day grace period, and freezing or unfreezing
 * the bands over the limit. `lib/planChange.ts` owns all of that, and a
 * webhook that wrote `profiles.plan` directly would silently skip every one of
 * them — a downgrade with no grace period, and bands left frozen after an
 * upgrade paid for.
 *
 * It passes `force`. By the time an event arrives the money has moved, and
 * refusing to grant what somebody paid for is the worse failure in every
 * direction. See the note on `ChangePlanOptions`.
 *
 * ── Trust ───────────────────────────────────────────────────────────────────
 * The signature is verified before the body is parsed, and the body is then
 * treated as Stripe's word on what was bought — but the *plan* is resolved
 * from the Price id, never from metadata, which anyone with dashboard access
 * can edit. The user is resolved from our own `billing_customers` table first,
 * and only falls back to metadata when the customer is unknown to us.
 */

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { BILLING_LIVE, STRIPE_WEBHOOK_SECRET } from '@/lib/billing/config'
import { stripeClient } from '@/lib/billing/stripe'
import {
  claimEvent,
  clearPaymentFailure,
  readLiveSubscription,
  recordPaymentFailure,
  releaseEvent,
  subscriptionGrantsPlan,
  syncAddonsFromSubscription,
  upsertSubscription,
  userIdForCustomer,
} from '@/lib/billing/store'
import { changePlan } from '@/lib/planChange'
import { settleAccount } from '@/lib/bandFreeze'

// Signature verification needs the raw body, and `stripe` is a Node library.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

/**
 * The subscription an invoice belongs to.
 *
 * Stripe moved this field: it used to be `invoice.subscription` and is now
 * `invoice.parent.subscription_details.subscription`. Both shapes are read
 * here on purpose — an API version bump must not quietly stop the dunning
 * banner from appearing, and the cost of checking twice is nothing.
 */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = idOf((invoice as unknown as { subscription?: unknown }).subscription)
  if (legacy) return legacy

  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } }
  }).parent
  return idOf(parent?.subscription_details?.subscription)
}

/**
 * Our user for a Stripe customer — from `billing_customers`, and from nowhere
 * else.
 *
 * ⚠ There is deliberately NO metadata fallback. It used to read
 * `subscription.metadata.supabase_user_id` when the customer was unknown to us,
 * and that field is editable by anybody with access to the Stripe dashboard —
 * so a typo, or one compromised dashboard session, assigned a paid plan to an
 * arbitrary account id. The plan itself is safe (it is resolved from the Price
 * id), but *which* account receives it was writable from outside the system.
 *
 * The fallback also fired in exactly the situation where no independent check
 * was available: the customer being unknown is the reason there was nothing to
 * check the claim against.
 *
 * Nothing legitimate needs it. `billing_customers` is written by
 * `getOrCreateStripeCustomer()` during `POST /api/billing/checkout`, before the
 * Checkout Session exists and therefore before any event about it can be sent.
 * A subscription created through this app always has its row. A customer we
 * cannot resolve belongs to another environment sharing the Stripe account, or
 * predates this system — in both cases doing nothing is correct.
 *
 * Metadata is still written at checkout, and is still worth having: it is the
 * trail back to the account from the Stripe side when someone is reading an
 * invoice by hand. It is simply not an authority here.
 */
async function resolveUserId(customer: unknown): Promise<string | null> {
  const customerId = idOf(customer)
  if (!customerId) return null
  return userIdForCustomer(customerId)
}

/**
 * Bring the app in line with one subscription, whatever moved it.
 *
 * Deliberately not a diff: every path — a first checkout, a portal switch, a
 * cancellation, a recovered payment — ends here and re-states the whole truth.
 * A handler per transition is how one rare transition ends up unhandled.
 *
 * ── Which subscription is the truth ─────────────────────────────────────────
 * Not, in general, the one the event carries. Stripe guarantees no ordering
 * between events, and a user can hold more than one subscription row over
 * time: cancel Band, resubscribe to Band+, and both a `deleted` for the old
 * one and a `created` for the new one are in flight at once. Handling the
 * `deleted` on its own terms resolves to `free` — `subscriptionGrantsPlan()`
 * returns the default for a status that no longer entitles anything — and
 * `changePlan(free, { force: true })` then downgrades a customer who is
 * paying right now, arms a grace period, and eventually freezes their bands
 * over a subscription they replaced.
 *
 * So the plan is resolved from whichever subscription is authoritative for
 * the user AFTER this event has been recorded, which is what
 * `readLiveSubscription()` answers: the most recent subscription that still
 * entitles a plan, falling back to the most recent live one only when there
 * is none. The event's own subscription is still mirrored first — that write
 * is keyed on Stripe's id and is what makes the answer current.
 *
 * That preference is also why a newer NON-entitling subscription cannot
 * downgrade a paying account: a second checkout stuck on 3DS (`incomplete`),
 * or a subscription that went `unpaid`, loses to the `active` one beside it,
 * and its own event is then skipped below as superseded. Recency alone would
 * hand it the decision.
 */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(sub.customer)
  if (!userId) {
    // Nothing to do and nothing a retry would fix: this customer belongs to
    // another environment sharing the same Stripe account, or predates us.
    // Fail closed — no plan is changed, and the caller still answers 200 so
    // Stripe stops retrying an event nobody here can act on. See
    // `resolveUserId` for why a user id in metadata is not accepted instead.
    console.warn(
      '[stripe] subscription for a customer not in billing_customers — no plan changed',
      sub.id,
      idOf(sub.customer),
    )
    return
  }

  // Bookkeeping first, unconditionally. Even a superseded subscription's final
  // state belongs in the table — it is what a support question is answered
  // from, and it is what the read below needs in order to be right about which
  // subscription is still live.
  await upsertSubscription(userId, sub)

  const live = await readLiveSubscription(userId)

  // A live subscription that is not this one means the event is about a
  // subscription this user has already moved off. Nothing to apply: the plan
  // they are entitled to is the one they are paying for, and this event would
  // only ever lower it.
  //
  // Returning normally (rather than throwing) is deliberate — the event has
  // already been claimed in `billing_events` and the caller answers 200.
  // Erroring would make Stripe retry a decision that is correctly a no-op,
  // forever, and every retry would race the same way.
  if (live && live.id !== sub.id) {
    console.log(
      '[stripe] ignoring event for superseded subscription',
      sub.id,
      '— live subscription is',
      live.id,
    )
    return
  }

  // Either this subscription IS the live one, or the user has none left — in
  // which case the event's own subscription is the last word and resolving it
  // to `free` is the correct downgrade.
  //
  // The plan first, then the addons: `changePlan` reconciles frozen bands
  // against the new limits, and addon capacity resolved before the plan landed
  // would be measured against the old ceiling.
  await changePlan(userId, subscriptionGrantsPlan(sub), { force: true })
  await syncAddonsFromSubscription(userId, sub)

  // ── Settle once the add-ons have landed ───────────────────────────────────
  //
  // `changePlan` runs its conflict checks against the add-on rows as they were
  // BEFORE this event, because the rows for what was just bought are written on
  // the line above it. The order is right — add-on capacity resolved before the
  // plan landed would be measured against the old ceiling — but it leaves the
  // account described by a check that is now out of date.
  //
  // A first checkout of Band+ (5 owned bands) with two `extra_band` add-ons is
  // the case that bites: the conflict check sees 5, the user owns 6, and a
  // 14-day grace period is armed over a conflict the add-ons resolved one line
  // later. `reconcileOwnerBands` ran with the same stale inputs.
  //
  // Settling here re-derives the state from the data as it now is: it clears a
  // deadline that no longer means anything, releases bands that fit again, and
  // — for the opposite case, an add-on revoked in the same event — starts a
  // clock where one is genuinely due. It used to happen eventually, on whatever
  // `GET /api/me/plan` or `GET /api/dashboard` the user loaded next; the point
  // is that the account is never momentarily described by a check made against
  // capacity that had not been written yet.
  await settleAccount(userId)
}

export async function POST(req: NextRequest) {
  if (!BILLING_LIVE || !STRIPE_WEBHOOK_SECRET) {
    // 404 rather than 503: an endpoint that answers differently depending on
    // whether keys exist tells an unauthenticated caller about our config.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const raw = await req.text()

  let event: Stripe.Event
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    // Never log the body: an unverified payload is an unknown caller's input.
    console.warn('[stripe] signature verification failed', (err as Error).message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const fresh = await claimEvent(event.id, event.type)
  if (!fresh) return NextResponse.json({ received: true, duplicate: true })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId = idOf(session.subscription)
        if (!subscriptionId) break
        // Retrieved rather than trusted from the session: the session is a
        // snapshot of an intent, the subscription is the thing that exists.
        const sub = await stripeClient().subscriptions.retrieve(subscriptionId)
        await applySubscription(sub)
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        await applySubscription(event.data.object as Stripe.Subscription)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = subscriptionIdFromInvoice(invoice)
        if (!subscriptionId) break
        await recordPaymentFailure(
          subscriptionId,
          invoice.id ?? null,
          (invoice as unknown as { next_payment_attempt?: number | null }).next_payment_attempt ??
            null,
        )
        // No plan change here. Stripe is still retrying; the subscription's own
        // status carries the consequence, and `past_due` still entitles the
        // plan on purpose — see `statusEntitles`.
        break
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = subscriptionIdFromInvoice(invoice)
        if (subscriptionId) await clearPaymentFailure(subscriptionId)
        break
      }

      default:
        // Everything else is noise to this app. Answering 200 is what stops
        // Stripe retrying an event nobody here will ever handle.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    // Hand the claim back so Stripe's retry is not silently skipped.
    await releaseEvent(event.id)
    console.error('[stripe] handler failed', event.type, err)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

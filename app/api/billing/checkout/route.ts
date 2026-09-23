/**
 * POST /api/billing/checkout — start paying for a plan.
 *
 * Body: { plan: 'solo' | 'band' | 'band_plus' }
 * Reply: { url, mode: 'checkout' | 'portal' }
 *
 * ── Two destinations, one button ────────────────────────────────────────────
 * A user with no live subscription goes to Stripe Checkout. A user who already
 * has one goes to the customer portal instead, because changing an existing
 * subscription is Stripe's job and doing it ourselves would mean computing
 * proration beside Stripe's own — two answers to "what do I owe today", which
 * is the one question that must have exactly one.
 *
 * ── The conflict pre-check ──────────────────────────────────────────────────
 * Solo allows fewer members per band than Free, so one of our upgrades can
 * leave an account over its own ceiling. This route refuses that *before* a
 * card is touched, with the same body the resolution screen already renders.
 * Once money has moved the refusal is no longer available — see the `force`
 * note in `lib/planChange.ts`.
 *
 * ⚠ Nothing here grants anything. A completed checkout is a Stripe event, and
 * `POST /api/stripe/webhook` is the only writer of `profiles.plan`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { BILLING_LIVE, planPriceId } from '@/lib/billing/config'
import { isBillingNotConfigured, stripeClient } from '@/lib/billing/stripe'
import { findEntitlingSubscription, getOrCreateStripeCustomer } from '@/lib/billing/store'
import { billingUrl } from '@/lib/billing/urls'
import { checkPlanConflicts, isBlockingConflict } from '@/lib/planConflicts'
import { isPlanId, type PlanId } from '@/lib/plans'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!BILLING_LIVE) {
    return NextResponse.json(
      { error: 'billing_unavailable', message: 'Checkout is not open yet.' },
      { status: 503 },
    )
  }

  let body: { plan?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isPlanId(body.plan) || body.plan === 'free') {
    return NextResponse.json({ error: 'plan must be solo, band or band_plus' }, { status: 400 })
  }
  const plan: PlanId = body.plan

  const priceId = planPriceId(plan)
  if (!priceId) {
    console.error(`[billing] no Stripe price configured for plan ${plan}`)
    return NextResponse.json(
      { error: 'billing_unavailable', message: 'That plan is not on sale yet.' },
      { status: 503 },
    )
  }

  try {
    // ── Refuse an upgrade that would land them over a ceiling ──────────────
    const conflicts = await checkPlanConflicts(userId, plan)
    const blocking = conflicts.filter(isBlockingConflict)
    if (blocking.length > 0) {
      return NextResponse.json(
        { ok: false, reason: 'conflicts_unresolved', to: plan, conflicts, blocking },
        { status: 409 },
      )
    }

    const customerId = await getOrCreateStripeCustomer(userId)
    const stripe = stripeClient()

    // ── Already subscribed: Stripe owns the change ─────────────────────────
    //
    // Asked of STRIPE, not of `billing_subscriptions`. The mirror is only as
    // current as the last webhook that landed, and the case this guard exists
    // for — a user pressing Subscribe a second time because the page still
    // shows the old plan — is precisely the case where the webhook has not
    // landed. Reading the mirror here produced two active subscriptions on one
    // customer, the second invisible to every screen and billing forever.
    const live = await findEntitlingSubscription(customerId)
    if (live) {
      // `?portal=return` is a marker, not a result: Stripe's portal tells us
      // nothing about what the user did in it, and a change made there may be
      // scheduled for period end rather than applied now. The billing page
      // reads it as "re-read the plan a few times", and accepts "unchanged".
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: billingUrl(req, '/billing?portal=return'),
      })
      return NextResponse.json({ url: portal.url, mode: 'portal' })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Promotion codes, tax ids and the address are Stripe's to collect —
      // each one we collected ourselves would be a form to build, validate and
      // keep on an invoice we do not render.
      allow_promotion_codes: true,
      tax_id_collection: { enabled: true },
      billing_address_collection: 'auto',
      // Required, not optional: the session always runs against an EXISTING
      // customer (`getOrCreateStripeCustomer` above), and Stripe refuses
      // `tax_id_collection` on one unless it is allowed to write the business
      // name back — otherwise it would collect a VAT id with nowhere to put it.
      // `address` is here for the same reason one step later: without it the
      // billing address the user types is used for the invoice and then
      // discarded, so the portal shows an empty address field and the next
      // invoice asks again.
      customer_update: { name: 'auto', address: 'auto' },
      // The plan travels in the success URL so the page that catches the
      // return knows what it is waiting FOR. Without it the only test available
      // is "not free", which says nothing on an upgrade between two paid plans
      // and would settle on the old one.
      success_url: billingUrl(req, `/billing?checkout=success&plan=${plan}`),
      cancel_url: billingUrl(req, '/billing?checkout=cancelled'),
      // Read back by the webhook only as a cross-check; the Price is what
      // actually decides the plan.
      subscription_data: { metadata: { supabase_user_id: userId, plan } },
      metadata: { supabase_user_id: userId, plan },
    })

    if (!session.url) {
      return NextResponse.json({ error: 'Could not open checkout' }, { status: 502 })
    }
    return NextResponse.json({ url: session.url, mode: 'checkout' })
  } catch (err) {
    if (isBillingNotConfigured(err)) {
      return NextResponse.json(
        { error: 'billing_unavailable', message: 'Checkout is not open yet.' },
        { status: 503 },
      )
    }
    console.error('[billing] checkout', err)
    return NextResponse.json(
      { error: 'Could not open checkout. Nothing was charged.' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/billing/addons — buy or drop one add-on.
 *
 * Body: { action: 'add' | 'remove', type: AddonType, bandId?: string }
 *
 * Add-ons are subscription items on the plan the user already pays for, which
 * is why they require a live subscription: there is no card on file to charge
 * otherwise, and a separate checkout per add-on would leave a person with two
 * subscriptions and two renewal dates for one workspace.
 *
 * Stripe prorates the change against the current period. We do not compute,
 * display or reconcile that amount anywhere — the invoice is the answer.
 *
 * ── Band scope ──────────────────────────────────────────────────────────────
 * `extra_storage` and `extra_member` attach to ONE band; `extra_band` is
 * account-wide. That split is enforced three times over: here, by the CHECK
 * constraint on `plan_addons`, and by the resolver in `lib/entitlements.ts`
 * which simply ignores a band-scoped addon while resolving a different band.
 * Ownership of the named band is verified against the database — a band id in
 * a request body is never trusted.
 *
 * The write to `plan_addons` still happens in `syncAddonsFromSubscription`,
 * from the subscription Stripe returns. This route calls it directly so the
 * page updates without waiting for the webhook, and the webhook then runs the
 * same reconciliation again, arriving at the same answer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { BILLING_LIVE, addonPriceId } from '@/lib/billing/config'
import { isBillingNotConfigured, stripeClient } from '@/lib/billing/stripe'
import {
  findEntitlingSubscription,
  readCustomerId,
  syncAddonsFromSubscription,
} from '@/lib/billing/store'
import { ADDONS, isAddonType, type AddonType } from '@/lib/plans'
import { addonHasEffect, getEffectiveEntitlements } from '@/lib/entitlements'

async function ownsBand(userId: string, bandId: string): Promise<boolean> {
  const { data } = await supabase
    .from('band_members')
    .select('band_id')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle()
  return !!data
}

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!BILLING_LIVE) {
    return NextResponse.json(
      { error: 'billing_unavailable', message: 'Add-ons are not on sale yet.' },
      { status: 503 },
    )
  }

  let body: { action?: unknown; type?: unknown; bandId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action === 'remove' ? 'remove' : body.action === 'add' ? 'add' : null
  if (!action) return NextResponse.json({ error: 'action must be add or remove' }, { status: 400 })

  if (!isAddonType(body.type)) {
    return NextResponse.json({ error: 'Unknown add-on' }, { status: 400 })
  }
  const type: AddonType = body.type
  const definition = ADDONS[type]

  let bandId: string | null = null
  if (definition.bandScoped) {
    if (typeof body.bandId !== 'string' || !body.bandId) {
      return NextResponse.json(
        { error: `${definition.name} attaches to one band — pick which.` },
        { status: 400 },
      )
    }
    if (!(await ownsBand(userId, body.bandId))) {
      // Not 403: saying "you do not own that band" to someone probing band ids
      // confirms the band exists. Nothing here needs to be that helpful.
      return NextResponse.json({ error: 'Unknown band' }, { status: 404 })
    }
    bandId = body.bandId
  }

  const priceId = addonPriceId(type)
  if (!priceId) {
    console.error(`[billing] no Stripe price configured for addon ${type}`)
    return NextResponse.json(
      { error: 'billing_unavailable', message: 'That add-on is not on sale yet.' },
      { status: 503 },
    )
  }

  // ── Refuse an add-on that cannot raise anything ───────────────────────────
  //
  // Some plans already grant unlimited on the dimension an add-on extends —
  // `extra_member` on Band and Band+, both of which have no member ceiling.
  // The resolver adds to `null` and gets `null` back, so the row is written,
  // the card is charged every month, and not one limit moves. The user has no
  // way to see that: the add-on appears in their list and the ceiling beside it
  // says "Unlimited" either way.
  //
  // The question "can this plan use this add-on" is a plan question, so it is
  // answered by `lib/entitlements.ts` — this route does not read a plan limit
  // itself, and must not start. The plan comes from the resolver too, never
  // from the request.
  //
  // Only `add` is guarded. Removing an add-on that grants nothing must stay
  // possible: that is how somebody undoes one bought before this check existed.
  if (action === 'add') {
    const { plan } = await getEffectiveEntitlements(userId)
    if (!addonHasEffect(plan, type)) {
      return NextResponse.json(
        {
          error: 'addon_without_effect',
          message: `${definition.name} would not change anything on your current plan — it already has no limit there.`,
          addon_type: type,
          plan,
        },
        { status: 409 },
      )
    }
  }

  try {
    // Stripe, not the mirror — same reasoning as the checkout guard. A webhook
    // that has not landed yet must not read as "you have no subscription" to
    // somebody who is holding the receipt. It also drops a round trip: the
    // subscription this used to retrieve by id comes back from the lookup.
    const stripe = stripeClient()
    const customerId = await readCustomerId(userId)
    const subscription = customerId ? await findEntitlingSubscription(customerId) : null
    if (!subscription) {
      return NextResponse.json(
        {
          error: 'no_subscription',
          message: 'Add-ons extend a paid plan. Choose a plan first, then add capacity to it.',
        },
        { status: 409 },
      )
    }

    // One item per (price, band): the band lives in item metadata, so the same
    // add-on on two different bands is genuinely two items, and the same
    // add-on twice on one band is a quantity.
    const existing = subscription.items.data.find(
      item =>
        item.price?.id === priceId &&
        (bandId === null ? !item.metadata?.band_id : item.metadata?.band_id === bandId),
    )

    if (action === 'add') {
      if (existing) {
        await stripe.subscriptionItems.update(existing.id, {
          quantity: (existing.quantity ?? 1) + 1,
        })
      } else {
        await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price: priceId,
          quantity: 1,
          ...(bandId ? { metadata: { band_id: bandId } } : {}),
        })
      }
    } else {
      if (!existing) {
        return NextResponse.json({ error: 'That add-on is not on this subscription' }, { status: 404 })
      }
      const quantity = existing.quantity ?? 1
      if (quantity > 1) {
        await stripe.subscriptionItems.update(existing.id, { quantity: quantity - 1 })
      } else {
        await stripe.subscriptionItems.del(existing.id)
      }
    }

    // Re-read rather than patching what we think we changed: the fresh
    // subscription is the only description of the items that is definitely
    // right, and it is what the webhook will reconcile against anyway.
    const updated = await stripe.subscriptions.retrieve(subscription.id)
    await syncAddonsFromSubscription(userId, updated)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isBillingNotConfigured(err)) {
      return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 })
    }
    console.error('[billing] addons', err)
    return NextResponse.json({ error: 'Could not change your add-ons' }, { status: 500 })
  }
}

/**
 * GET /api/me/billing/upcoming — what the next invoice will actually come to.
 *
 * ── Why this is a Stripe call and not arithmetic ────────────────────────────
 *
 * The billing screen shows a total at the bottom. The tempting way to produce
 * it is to add up the plan's price string and the add-on price strings in the
 * browser. `lib/plans.ts` says of those strings that nothing parses them, and
 * this is the reason: the number a user reads on a billing screen has to be
 * the number their card is charged, and the only thing that knows that is
 * Stripe. A sum computed here would drift the first time a coupon, a tax rate,
 * a mid-period proration, a credit balance or a currency got involved — and it
 * would drift silently, in the place where being wrong is least forgivable.
 *
 * So this asks. `invoices.createPreview` returns the invoice Stripe *would*
 * issue right now for the subscription, prorations included. It creates
 * nothing and charges nothing.
 *
 * ── What the numbers mean ───────────────────────────────────────────────────
 *
 * All amounts are in the currency's minor unit (cents), as Stripe returns
 * them; formatting is the client's job and uses `currency` rather than a
 * hardcoded symbol.
 *
 *   subtotal   before credit balance
 *   total      after discounts and tax
 *   amountDue  what will actually be collected — `total` minus any credit the
 *              account is carrying. This is the headline figure; the other two
 *              exist so the screen can explain a difference instead of showing
 *              a number that does not match the plan's sticker price.
 *
 * `plan` / `addons` / `adjustments` are the breakdown: recurring amounts by
 * what they pay for, and anything that is not recurring (a proration left by
 * the old flow, a one-off item) in its own group, in Stripe's own words.
 *
 * ── Absence is not an error ─────────────────────────────────────────────────
 *
 * No billing keys, no customer, no live subscription, or a subscription that
 * ends at period end and has nothing more to bill: all of these mean "there is
 * no next invoice", which is a fact about the account, not a failure. They
 * answer 200 with `{ available: false }` and a reason. Only a real fault is a
 * 500, and even then the screen is expected to keep working without the total.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { BILLING_LIVE } from '@/lib/billing/config'
import { isBillingNotConfigured, stripeClient } from '@/lib/billing/stripe'
import { findEntitlingSubscription, readCustomerId } from '@/lib/billing/store'
import { addonForPriceId, planForPriceId } from '@/lib/billing/config'
import { ADDONS, ADDON_ORDER, PLANS, type AddonType } from '@/lib/plans'

/** Enough lines to explain a total; more than anyone reads on a billing page. */
const MAX_LINES = 12

type Unavailable =
  | 'billing_not_live'
  | 'no_customer'
  | 'no_subscription'
  | 'nothing_upcoming'

function unavailable(reason: Unavailable) {
  return NextResponse.json({ available: false, reason })
}

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!BILLING_LIVE) return unavailable('billing_not_live')

  try {
    const customerId = await readCustomerId(userId)
    if (!customerId) return unavailable('no_customer')

    // Stripe, not the mirror — same reasoning as the checkout and add-on
    // routes. A webhook that has not landed yet must not read as "you have no
    // subscription" to somebody who is holding the receipt.
    const subscription = await findEntitlingSubscription(customerId)
    if (!subscription) return unavailable('no_subscription')

    const stripe = stripeClient()
    const preview = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.id,
    })

    // ── A breakdown, not one merged number ──────────────────────────────────
    //
    // Add-ons are charged at the moment they are added now, so a renewal
    // invoice should hold only recurring amounts: the plan and the add-ons
    // that renew. Each line is classified by its Price id (the same mapping
    // the webhook grants from); anything else — a proration left behind by
    // the old deferred-charge flow, a one-off invoice item — is shown as an
    // adjustment in its own group instead of being folded into the total
    // without a word. Add-ons scheduled to end are not on the subscription
    // any more, so they cannot appear here at all.
    let planAmount = 0
    let planName: string | null = null
    const addons = new Map<AddonType, { quantity: number; amount: number }>()
    const adjustments: { description: string; amount: number }[] = []

    for (const line of preview.lines.data) {
      const proration = line.parent?.subscription_item_details?.proration ?? false
      const priceRef = line.pricing?.price_details?.price
      const priceId = typeof priceRef === 'string' ? priceRef : priceRef?.id ?? null
      const planId = proration ? null : planForPriceId(priceId)
      const addon = proration ? null : addonForPriceId(priceId)

      if (planId) {
        planName = PLANS[planId].name
        planAmount += line.amount
      } else if (addon) {
        const prev = addons.get(addon) ?? { quantity: 0, amount: 0 }
        addons.set(addon, {
          quantity: prev.quantity + (line.quantity ?? 0),
          amount: prev.amount + line.amount,
        })
      } else if (adjustments.length < MAX_LINES) {
        adjustments.push({ description: line.description ?? 'Adjustment', amount: line.amount })
      }
    }

    const tax = (preview.total_taxes ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0)
    const discount = (preview.total_discount_amounts ?? []).reduce(
      (sum, d) => sum + (d.amount ?? 0),
      0,
    )

    return NextResponse.json({
      available: true,
      currency: preview.currency,
      subtotal: preview.subtotal,
      total: preview.total,
      amountDue: preview.amount_due,
      /**
       * Negative when the account carries credit. Surfaced so the screen can
       * explain why the total is below the sticker price instead of looking
       * like a bug.
       */
      startingBalance: preview.starting_balance,
      /**
       * When Stripe expects to bill it. `next_payment_attempt` is set on a
       * draft upcoming invoice; `period_end` is the fallback.
       */
      dueAt: preview.next_payment_attempt
        ? new Date(preview.next_payment_attempt * 1000).toISOString()
        : preview.period_end
          ? new Date(preview.period_end * 1000).toISOString()
          : null,
      plan: planName ? { description: planName, amount: planAmount } : null,
      addons: ADDON_ORDER.filter(type => addons.has(type)).map(type => ({
        type,
        name: ADDONS[type].name,
        ...addons.get(type)!,
      })),
      adjustments,
      tax,
      discount,
      truncated: preview.lines.has_more || adjustments.length >= MAX_LINES,
    })
  } catch (err) {
    if (isBillingNotConfigured(err)) return unavailable('billing_not_live')

    // Stripe raises this when the subscription has nothing left to invoice —
    // cancelled, or ending at period end with no further charge. That is an
    // answer, not a fault.
    const code = (err as { code?: string })?.code
    if (code === 'invoice_upcoming_none') return unavailable('nothing_upcoming')

    console.error('[billing] me/billing/upcoming', err)
    return NextResponse.json({ error: 'Could not read your next invoice' }, { status: 500 })
  }
}

/**
 * GET /api/me/billing — what the billing screen needs, and nothing more.
 *
 * Deliberately separate from `GET /api/me/plan`. That endpoint answers "what
 * am I entitled to" and is fetched on every page load by the paywall context;
 * this one answers "what did I buy and is the card working", is read by one
 * screen, and touches tables no entitlement check may ever join.
 *
 * Every field is display copy. Nothing here is an input to a limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { BILLING_LIVE } from '@/lib/billing/config'
import { readCustomerId, readLiveSubscription, statusEntitles } from '@/lib/billing/store'

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [subscription, customerId] = await Promise.all([
      readLiveSubscription(userId),
      readCustomerId(userId),
    ])

    return NextResponse.json({
      billingLive: BILLING_LIVE,
      /** True once the account has ever reached Stripe — the portal needs it. */
      hasBillingAccount: customerId !== null,
      subscription: subscription
        ? {
            status: subscription.status,
            plan: subscription.plan,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            /** Set only while a payment is failing and Stripe is retrying. */
            paymentFailedAt: subscription.paymentFailedAt,
            nextPaymentAttempt: subscription.nextPaymentAttempt,
            entitling: statusEntitles(subscription.status),
          }
        : null,
    })
  } catch (err) {
    console.error('[billing] me/billing', err)
    return NextResponse.json({ error: 'Could not read your billing details' }, { status: 500 })
  }
}

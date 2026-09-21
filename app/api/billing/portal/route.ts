/**
 * POST /api/billing/portal — hand the user to Stripe's customer portal.
 *
 * The payment method, the invoice history, the tax id, cancelling and
 * reactivating all live there. Every one of those is a screen Stripe already
 * builds, keeps compliant and localises; the app's job is to explain what a
 * change will do to their bands, and then get out of the way.
 *
 * A user with no Stripe customer has never paid, so there is nothing to
 * manage: they get a 409 rather than an empty portal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { BILLING_LIVE } from '@/lib/billing/config'
import { isBillingNotConfigured, stripeClient } from '@/lib/billing/stripe'
import { readCustomerId } from '@/lib/billing/store'
import { billingUrl } from '@/lib/billing/urls'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!BILLING_LIVE) {
    return NextResponse.json(
      { error: 'billing_unavailable', message: 'Billing is not open yet.' },
      { status: 503 },
    )
  }

  try {
    const customerId = await readCustomerId(userId)
    if (!customerId) {
      return NextResponse.json(
        { error: 'no_customer', message: 'There is no billing history on this account yet.' },
        { status: 409 },
      )
    }

    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: billingUrl(req, '/billing'),
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    if (isBillingNotConfigured(err)) {
      return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 })
    }
    console.error('[billing] portal', err)
    return NextResponse.json({ error: 'Could not open the billing portal' }, { status: 500 })
  }
}

/**
 * POST /api/billing/addons — RETIRED.
 *
 * This used to add or remove one add-on per click with Stripe's default
 * `create_prorations`: capacity granted at once, charge deferred to the next
 * renewal (which a subscription cancelled at period end never has). It is
 * answered with 410 rather than deleted so a browser still holding the old
 * bundle gets a clear refusal instead of a 404 that looks like an outage —
 * and so nothing can ever reach the old behaviour again.
 *
 * The flow now is:
 *   POST /api/billing/addons/preview      Stripe prices the staged changes
 *   POST /api/billing/addons/confirm      one payment for all of them
 *   GET  /api/billing/addons/orders/[id]  poll until the webhook grants it
 *   POST /api/billing/addons/orders/[id]/cancel   abandon 3D Secure
 *   POST /api/billing/addons/keep         undo a scheduled removal (free)
 *
 * See `lib/billing/addonOrders.ts`.
 */

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'gone',
      message: 'This page is out of date. Reload it to change your add-ons.',
    },
    { status: 410 },
  )
}

/**
 * GET /api/billing/addons/orders/[id] — where an add-on payment has got to.
 *
 * Refreshed from Stripe on every read, so a voided or expired invoice is
 * reported as such even if its webhook never arrived. `applied` is the only
 * status that means the add-ons exist; it is set by the webhook.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { orderView } from '@/lib/billing/addonOrders'
import { addonErrorResponse } from '@/lib/billing/addonRoute'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    return NextResponse.json({ order: await orderView(id, userId) })
  } catch (err) {
    return addonErrorResponse(err, 'addons/orders')
  }
}

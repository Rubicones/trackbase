/**
 * POST /api/billing/addons/orders/[id]/cancel — abandon a payment awaiting
 * 3D Secure. Voids its invoice, which discards the pending update: no charge,
 * no add-on. If the bank already approved it, the answer says so instead.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { cancelAddonOrder } from '@/lib/billing/addonOrders'
import { addonErrorResponse } from '@/lib/billing/addonRoute'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    return NextResponse.json({ order: await cancelAddonOrder(userId, id) })
  } catch (err) {
    return addonErrorResponse(err, 'addons/orders/cancel')
  }
}

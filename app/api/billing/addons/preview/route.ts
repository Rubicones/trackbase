/**
 * POST /api/billing/addons/preview — what the staged changes would cost.
 *
 * Body: { changes: [{ type, bandId?, delta }] }
 *
 * Stripe prices it (`invoices.createPreview`, `always_invoice`, at a fixed
 * `proration_date`) and nothing is created or charged. The answer carries the
 * `prorationDate` it was priced at; the confirm must send it back, which is
 * what makes the amount on the button the amount on the card, to the cent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { previewAddonChanges } from '@/lib/billing/addonOrders'
import { addonErrorResponse, readJson } from '@/lib/billing/addonRoute'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    return NextResponse.json(await previewAddonChanges(userId, body.changes))
  } catch (err) {
    return addonErrorResponse(err, 'addons/preview')
  }
}

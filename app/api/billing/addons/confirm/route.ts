/**
 * POST /api/billing/addons/confirm — apply the staged changes: ONE payment.
 *
 * Body: { changes, prorationDate, expectedAmount, expectedCurrency }
 *
 * Re-prices at the quote's `prorationDate` and refuses (409 `amount_changed`)
 * if the figure the user saw is not the figure Stripe would charge. Then one
 * `subscriptions.update` with `pending_if_incomplete` + `always_invoice`:
 * the add-ons exist only if that invoice is paid.
 *
 * NOTHING is granted here. The answer is an order to poll:
 *   processing | paid          → poll GET /orders/[id] until `applied`
 *   requires_action            → 3D Secure; `hostedInvoiceUrl` completes it
 *   failed                     → declined; nothing changed, invoice voided
 *   applied                    → removals only (no money moved)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { confirmAddonChanges } from '@/lib/billing/addonOrders'
import { addonErrorResponse, readJson } from '@/lib/billing/addonRoute'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    return NextResponse.json({ order: await confirmAddonChanges(userId, body) })
  } catch (err) {
    return addonErrorResponse(err, 'addons/confirm')
  }
}

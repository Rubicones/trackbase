/**
 * POST /api/billing/addons/keep — cancel a scheduled removal.
 *
 * Body: { type, bandId? }
 *
 * Free and immediate: the period is already paid for, so the units go back on
 * the subscription with `proration_behavior: 'none'` and renew as before.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { keepEndingAddon } from '@/lib/billing/addonOrders'
import { addonErrorResponse, readJson } from '@/lib/billing/addonRoute'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  try {
    await keepEndingAddon(userId, body)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return addonErrorResponse(err, 'addons/keep')
  }
}

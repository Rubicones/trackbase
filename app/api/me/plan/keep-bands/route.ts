/**
 * "If it comes to it, keep these bands."
 *
 * The user chooses during the grace period which bands survive when it ends.
 * If they never choose, the least recently active ones are the ones that
 * freeze — see `lib/freezeOrder.ts`, which is the single implementation of
 * that rule for both the preview and the enforcement.
 *
 * The choice is a preference, not an entitlement: it can name bands they no
 * longer own, or more bands than they are allowed, and both are tolerated and
 * trimmed at the moment it is applied. Nothing here can raise a limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { resolvePlanState } from '@/lib/entitlements'
import { setGraceKeepBands } from '@/lib/planChange'

export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { bandIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.bandIds)) {
    return NextResponse.json({ error: 'bandIds must be an array' }, { status: 400 })
  }
  const bandIds = body.bandIds.filter((v): v is string => typeof v === 'string')

  try {
    await setGraceKeepBands(userId, bandIds)
    const state = await resolvePlanState(userId)
    return NextResponse.json({ keepBandIds: state.keepBandIds, state: state.state })
  } catch (err) {
    console.error('[me/plan/keep-bands]', err)
    return NextResponse.json({ error: 'Could not save your choice' }, { status: 500 })
  }
}

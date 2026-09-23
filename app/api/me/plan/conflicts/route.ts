/**
 * "What would break if I switched to X?"
 *
 * Read-only. The resolution screen calls this to render before the user
 * commits, and calls it again after each member removal to re-check whether
 * the confirm button can be enabled. The button's enabled state is UX; the
 * actual gate is in POST /api/me/plan, which re-runs the same check.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { isPlanId, planChangeDirection } from '@/lib/plans'
import { resolvePlanState } from '@/lib/entitlements'
import { checkPlanConflicts, isBlockingConflict } from '@/lib/planConflicts'

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const target = req.nextUrl.searchParams.get('target')
  if (!isPlanId(target)) {
    return NextResponse.json({ error: 'target must be free, solo, band or band_plus' }, { status: 400 })
  }

  try {
    const state = await resolvePlanState(userId)
    const conflicts = await checkPlanConflicts(userId, target)
    const blocking = conflicts.filter(isBlockingConflict)
    const direction = planChangeDirection(state.plan, target)

    return NextResponse.json({
      from: state.plan,
      target,
      direction,
      conflicts,
      blocking,
      // Downgrades are never blocked — the user has already decided, and the
      // grace period is what protects their data, not a wall in front of them.
      canProceed: direction === 'downgrade' || blocking.length === 0,
    })
  } catch (err) {
    console.error('[me/plan/conflicts]', err)
    return NextResponse.json({ error: 'Could not check your plan' }, { status: 500 })
  }
}

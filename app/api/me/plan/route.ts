/**
 * The user's own plan: read it, and change it.
 *
 * GET  — everything a plan surface needs in one round trip: the resolved
 *        entitlements, the derived state (active / grace / enforced), and
 *        current usage against every limit. Read-only; always available.
 * POST — run the real upgrade or downgrade flow. This is the endpoint the dev
 *        switcher calls, and it is the endpoint Stripe would call into later;
 *        neither gets a shortcut past the conflict checks.
 *
 * ⚠ POST IS DEV-GATED. There is no billing, so there is no legitimate way for a
 * user to choose their own plan — a reachable POST here is a self-serve grant of
 * `band_plus`, which is the entire entitlement system defeated in one request.
 * `DEV_PLAN_TOOLS_AVAILABLE` is the same NODE_ENV test `/api/dev/plan` and the
 * `DevPlanSwitcher` component apply, so the UI, this route and the dev tooling
 * agree. 404, not 403, so its existence is not advertised.
 *
 * When Stripe arrives, the caller becomes the webhook handler: replace this gate
 * with signature verification of the Stripe event, keeping the rule that the
 * plan value never originates from the browser.
 *
 * Identity always comes from the session cookie. A user id in the body is
 * ignored, not honoured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { DEV_PLAN_TOOLS_AVAILABLE } from '@/lib/devPlanTools'
import { isPlanId, mbToBytes, PLANS, type PlanId } from '@/lib/plans'
import {
  countOwnedBands,
  getEffectiveEntitlements,
  listOwnedBands,
  resolvePlanState,
} from '@/lib/entitlements'
import { checkPlanConflicts } from '@/lib/planConflicts'
import { changePlan } from '@/lib/planChange'

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const [entitlements, state, owned, ownedCount] = await Promise.all([
      getEffectiveEntitlements(userId),
      resolvePlanState(userId),
      listOwnedBands(userId),
      countOwnedBands(userId),
    ])

    // Conflicts against the CURRENT plan — i.e. "what is still wrong right
    // now", which is what the grace banner counts down over.
    const conflicts = state.state === 'active' && !state.graceUntil
      ? []
      : await checkPlanConflicts(userId, entitlements.plan)

    return NextResponse.json({
      plan: entitlements.plan,
      state: state.state,
      graceUntil: state.graceUntil,
      graceDaysLeft: state.graceDaysLeft,
      keepBandIds: state.keepBandIds,
      provisioned: entitlements.provisioned,
      limits: {
        bandsOwned: entitlements.bandsOwned,
        membersPerBand: entitlements.membersPerBand,
        storagePerBandMB: entitlements.storagePerBandMB,
        storagePerBandBytes: mbToBytes(entitlements.storagePerBandMB),
        activeVersionsPerProject: entitlements.activeVersionsPerProject,
      },
      features: entitlements.features,
      bandsOwnedOverridden: entitlements.bandsOwnedOverridden,
      usage: {
        bandsOwned: ownedCount,
        bands: owned.map(b => ({
          id: b.id,
          name: b.name,
          memberCount: b.memberCount,
          storageBytes: b.storageBytes,
          lastActivityAt: b.lastActivityAt,
          frozen: b.frozenAt !== null,
          frozenReason: b.frozenReason,
        })),
      },
      conflicts,
      // Prices and plan shapes come from the same constant the server enforces,
      // so the modal can never advertise a limit the server does not honour.
      catalog: PLANS,
    })
  } catch (err) {
    console.error('[me/plan] GET', err)
    return NextResponse.json({ error: 'Could not read your plan' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // No self-serve plan assignment in a deployed environment. See the header.
  if (!DEV_PLAN_TOOLS_AVAILABLE) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { plan?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isPlanId(body.plan)) {
    return NextResponse.json({ error: 'plan must be free, solo, band or band_plus' }, { status: 400 })
  }
  const target: PlanId = body.plan

  try {
    const result = await changePlan(userId, target)

    // An upgrade with unresolved blocking conflicts is a refusal, not an
    // error: the body carries exactly what the resolution screen needs.
    if (!result.ok) return NextResponse.json(result, { status: 409 })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[me/plan] POST', err)
    return NextResponse.json({ error: 'Could not change your plan' }, { status: 500 })
  }
}

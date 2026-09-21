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
  readAddons,
  resolvePlanState,
} from '@/lib/entitlements'
import { checkPlanConflicts } from '@/lib/planConflicts'
import { settleAccount } from '@/lib/bandFreeze'
import { changePlan } from '@/lib/planChange'
import { BILLING_LIVE } from '@/lib/billing/config'

export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // ── Settle the account before describing it ───────────────────────────
    //
    // Freezing is lazy by design: a band nobody opens is frozen the moment
    // someone touches it (`lib/bandFreeze.ts`), and grace is cleared by the
    // same pass once the data fits the plan again. Both of those ran from the
    // band routes and from the dev switcher — but never from here, which is
    // the endpoint every plan surface reads.
    //
    // That produced two wrong answers at once. The dashboard announced "bands
    // over your limit are frozen" while nothing had been frozen yet, because
    // no band had been opened since grace expired. And granting capacity —
    // an extra_band addon, an upgrade applied elsewhere — left `grace_until`
    // sitting in the past, so `resolvePlanState` kept deriving `enforced` from
    // a stale timestamp and the banner would not go away no matter how much
    // room the account had.
    //
    // Reconciling first fixes both: whatever this endpoint then reports is
    // true at the moment it is read. See `settleAccount` for the full note.
    await settleAccount(userId)

    const [entitlements, state, owned, ownedCount, addons] = await Promise.all([
      getEffectiveEntitlements(userId),
      resolvePlanState(userId),
      listOwnedBands(userId),
      countOwnedBands(userId),
      readAddons(userId),
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
      // Whether this deployment can actually charge a card. The browser cannot
      // work this out for itself — the Stripe keys are server-only — and the
      // answer decides whether "Subscribe" opens a checkout or records demand
      // in `subscription_intents` the way it does today.
      billingLive: BILLING_LIVE,
      // Addons, so a usage panel can say WHY a band's ceiling is higher than
      // the plan's. The resolved limits above already include them; this list
      // exists to explain them, never to be re-added by the client.
      addons: addons.map(a => ({
        id: a.id,
        type: a.type,
        bandId: a.bandId,
        quantity: a.quantity,
      })),
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

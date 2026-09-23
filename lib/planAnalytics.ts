/**
 * Plan analytics.
 *
 * All of it goes through `trackEvent` (`lib/analytics.ts`), which fans out to
 * GA4, the Meta Pixel and Yandex Metrica — a new event needs no
 * per-destination work.
 *
 * **No PII in parameters.** No user id, no email, no band or project name, no
 * band id. Plan ids, limit types, conflict types and counts only. This mirrors
 * the discipline the rest of the app's ~80 events already follow.
 *
 * Everything here fires from the client, because `trackEvent` needs
 * `window.gtag`. The server-side state transitions (a band freezing, a grace
 * period expiring) are therefore reported when the UI first observes them,
 * which is also the only moment a human could have noticed. The `once` guards
 * keep a re-render or a poll from inflating the counts.
 */

import { trackEvent } from '@/lib/analytics'
import type { GatedFeature, PlanId } from '@/lib/plans'
import type { ConflictType } from '@/lib/planConflicts'
import type { LimitType } from '@/lib/planCopy'

/** Fired-once keys, per page load. */
const fired = new Set<string>()

function once(key: string, fn: () => void) {
  if (fired.has(key)) return
  fired.add(key)
  fn()
}

export function trackPlanChanged(
  from: PlanId,
  to: PlanId,
  direction: 'upgrade' | 'downgrade',
) {
  trackEvent('plan_changed', { from, to, direction })
}

export function trackPlanConflictShown(targetPlan: PlanId, conflictTypes: ConflictType[]) {
  trackEvent('plan_conflict_shown', {
    target_plan: targetPlan,
    // Deduplicated and joined: GA4 params are scalars, and "which kinds of
    // conflict did this user see" is the question, not how many of each.
    conflict_types: [...new Set(conflictTypes)].sort().join(','),
  })
}

export function trackPlanConflictResolved(targetPlan: PlanId, conflictType: ConflictType) {
  trackEvent('plan_conflict_resolved', { target_plan: targetPlan, conflict_type: conflictType })
}

/** Once per limit type per page load — hitting a wall is one event, not one per retry. */
export function trackLimitReached(limitType: LimitType, plan: PlanId) {
  once(`limit:${limitType}:${plan}`, () => {
    trackEvent('limit_reached', { limit_type: limitType, plan })
  })
}

export function trackBandFrozen(reason: string) {
  once(`frozen:${reason}`, () => trackEvent('band_frozen', { reason }))
}

export function trackBandUnfrozen(reason: string) {
  once(`unfrozen:${reason}`, () => trackEvent('band_unfrozen', { reason }))
}

export function trackGracePeriodStarted(plan: PlanId) {
  trackEvent('grace_period_started', { plan })
}

export function trackGracePeriodExpired(plan: PlanId) {
  once(`grace_expired:${plan}`, () => trackEvent('grace_period_expired', { plan }))
}

/** Demand signal when a locked feature is clicked. Pre-existing event name. */
export function trackFeatureLockClicked(feature: GatedFeature) {
  trackEvent('paywall_lock_clicked', { feature })
}

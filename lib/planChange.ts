/**
 * Upgrade and downgrade.
 *
 * The two directions are deliberately asymmetric:
 *
 *   UPGRADE is blocked until conflicts are resolved. An account must never
 *   land in a paid state that violates its own plan's limits — that produces a
 *   paying user who is immediately over quota, which is both confusing and
 *   unfair. The only conflict an upgrade can actually create is a *lower*
 *   member ceiling (Free's 3 → Solo's 2); everything else only rises. So the
 *   user removes a member first, or the upgrade does not happen.
 *
 *   DOWNGRADE is immediate and unobstructed. The user has already decided.
 *   Putting a resolution screen in front of someone trying to spend less money
 *   is hostile, and it does not protect anything: the data is already there and
 *   nothing is deleted either way. Features lock at once, structural conflicts
 *   get 14 days of grace, and members are never touched.
 *
 * Where the plan value came from is not this module's business. Today it is the
 * dev switcher. When Stripe arrives it will set `profiles.plan` and insert
 * `plan_addons` rows and nothing below needs to change — that is the seam.
 */

import { supabase } from '@/lib/supabase'
import {
  planChangeDirection,
  type PlanChangeDirection,
  type PlanId,
} from '@/lib/plans'
import {
  graceDeadlineFromNow,
  resolvePlanState,
  type AccountPlanState,
} from '@/lib/entitlements'
import {
  checkPlanConflicts,
  isBlockingConflict,
  type Conflict,
} from '@/lib/planConflicts'
import { reconcileOwnerBands } from '@/lib/bandFreeze'

export interface PlanChangeRefusal {
  ok: false
  reason: 'conflicts_unresolved'
  from: PlanId
  to: PlanId
  direction: PlanChangeDirection
  /** Everything found, so the screen can explain the whole picture… */
  conflicts: Conflict[]
  /** …and the subset that actually has to be cleared before the confirm. */
  blocking: Conflict[]
}

export interface PlanChangeSuccess {
  ok: true
  from: PlanId
  to: PlanId
  direction: PlanChangeDirection
  /** Conflicts that remain, deliberately, under the new plan. */
  conflicts: Conflict[]
  graceUntil: string | null
  graceStarted: boolean
  state: AccountPlanState
}

export type PlanChangeResult = PlanChangeSuccess | PlanChangeRefusal

/**
 * Apply a plan change for `userId`.
 *
 * The acting user always comes from the session at the call site; this
 * function does not read identity from anywhere.
 */
export interface ChangePlanOptions {
  /**
   * Apply the change even when blocking conflicts stand.
   *
   * Exactly one caller may pass this: the Stripe webhook. By the time an event
   * arrives the money has already moved, and refusing to grant what somebody
   * paid for is worse in every direction — they are charged for a plan the app
   * pretends they do not have, and no screen can explain it. The conflict does
   * not disappear, it simply becomes an ordinary over-limit state, which this
   * system already handles: nothing is deleted, no member is removed, and the
   * only consequence is that adding another member is refused until they are
   * back under the ceiling.
   *
   * The pre-purchase check still happens — `POST /api/billing/checkout` runs
   * the same `checkPlanConflicts` and refuses before a card is touched. This
   * flag only covers the case where the change originated in Stripe (the
   * customer portal, a dashboard edit, a failed-then-recovered payment).
   */
  force?: boolean
}

export async function changePlan(
  userId: string,
  to: PlanId,
  options: ChangePlanOptions = {},
): Promise<PlanChangeResult> {
  const before = await resolvePlanState(userId)
  const from = before.plan
  const direction = planChangeDirection(from, to)

  const conflicts = await checkPlanConflicts(userId, to)

  // ── Upgrade: refuse while blocking conflicts stand ────────────────────────
  if (direction === 'upgrade' && !options.force) {
    const blocking = conflicts.filter(isBlockingConflict)
    if (blocking.length > 0) {
      return { ok: false, reason: 'conflicts_unresolved', from, to, direction, conflicts, blocking }
    }
  }

  // ── Same plan: nothing to write, but still reconcile ──────────────────────
  // Re-selecting the current plan is how the dev switcher re-runs the flow, and
  // it is also what the UI does after a user resolves a conflict. Falling
  // through (rather than short-circuiting) means the grace deadline and the
  // frozen bands are re-evaluated against the data as it is now.

  // ── Grace ─────────────────────────────────────────────────────────────────
  // A downgrade that leaves structural conflicts starts a fresh 14 days. A
  // change that leaves none clears any deadline outright: grace exists to give
  // the user time to fix something, so with nothing to fix it must not linger,
  // or the banner would keep counting down over a resolved problem.
  //
  // An UPGRADE that leaves conflicts also starts a fresh 14 days, and this is
  // the one case that is not obvious. Until 2026-09-21 it carried the old
  // deadline forward, which meant an upgrade out of the enforced state
  // inherited a timestamp already in the past: `resolvePlanState` read it back
  // as `enforced` and `reconcileOwnerBands` was called with `enforce: true`
  // three lines later — so the user paid, and the transaction's own last act
  // was to re-freeze the bands they had just paid to get back. Nobody may
  // inherit a dead deadline on the way up. The deadline is replaced whether
  // the old one had expired or not — an upgrade that still leaves a conflict
  // is a user who has just paid and now has a NEW, smaller problem to solve,
  // and the clock for it starts now. Nothing here can shorten a grace period:
  // the replacement is always 14 days out, which is never earlier than what it
  // replaced.
  //
  // `direction === 'none'` is deliberately excluded, expired deadline and all.
  // Re-stating the current plan is what the dev switcher does on re-select,
  // what the UI does after a conflict is resolved, and what Stripe does on
  // every `customer.subscription.updated` that has nothing to do with the plan
  // (a card replaced, metadata edited). Arming a fresh period on any of those
  // would lift an account out of `enforced` and unfreeze its bands, over and
  // over, and `enforced` would become a state nobody could stay in. It is also
  // what keeps a duplicate webhook a no-op — a repeat delivery arrives as
  // `none` and lands on the carry-forward branch, so no second grace period is
  // created.
  //
  //   downgrade + conflicts → fresh 14 days
  //   upgrade   + conflicts → fresh 14 days   ← the 2026-09-21 change
  //   none      + conflicts → carried forward as-is, expired or not
  //   any       + none      → cleared
  const armsFreshGrace =
    conflicts.length > 0 && (direction === 'downgrade' || direction === 'upgrade')

  const graceUntil = armsFreshGrace
    ? graceDeadlineFromNow()
    : conflicts.length > 0
      ? before.graceUntil
      : null

  const update: Record<string, unknown> = { plan: to, grace_until: graceUntil }
  // The keep-choice belongs to one grace period. A new one starts blank.
  if (armsFreshGrace || graceUntil === null) update.grace_keep_band_ids = null

  const { error } = await supabase.from('profiles').update(update).eq('id', userId)
  if (error) throw error

  const after = await resolvePlanState(userId)

  // Freeze/unfreeze immediately in line with the new state. An upgrade out of
  // the enforced state unfreezes here, before the user navigates anywhere —
  // they should not have to open a band to get it back.
  await reconcileOwnerBands(userId, after.state === 'enforced')

  return {
    ok: true,
    from,
    to,
    direction,
    conflicts,
    graceUntil: after.graceUntil,
    graceStarted: armsFreshGrace && before.graceUntil !== after.graceUntil,
    state: after,
  }
}

/**
 * Set the user's choice of which bands to keep when grace expires.
 *
 * Stored as-is (order is the priority order); {@link splitBandsForFreeze}
 * validates it against what they actually own at the moment it is applied, so
 * a stale id here is harmless.
 */
export async function setGraceKeepBands(userId: string, bandIds: string[]): Promise<void> {
  const clean = [...new Set(bandIds.filter(id => typeof id === 'string' && id.length > 0))]
  const { error } = await supabase
    .from('profiles')
    .update({ grace_keep_band_ids: clean.length ? clean : null })
    .eq('id', userId)
  if (error) throw error
}

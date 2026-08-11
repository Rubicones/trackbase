/**
 * Frozen bands — lazy evaluation, and the server-side write block.
 *
 * ── Lazy, not scheduled ─────────────────────────────────────────────────────
 * There is no cron job and no background worker. A band nobody opens does not
 * need to be frozen in the background; it gets frozen the moment someone
 * touches it. `ensureBandFreezeState()` is called from the auth guards
 * (`lib/supabase/server.ts`, `lib/bandAccess.ts`), so the check happens
 * exactly when the band is requested — the same pattern the preview-mix cache
 * uses (`lib/previewMix.ts`).
 *
 * The common case must therefore be cheap. It is: one read of the band row and
 * one read of the owner's profile. The expensive part — inventorying every
 * owned band and computing the split — only runs when the owner is actually in
 * the enforced state, or when this band is already frozen and might now be
 * eligible to come back.
 *
 * ── What frozen means ───────────────────────────────────────────────────────
 * Read-only. Nothing is deleted, ever. Viewing, playback, downloads and chat
 * history all keep working; every write is refused. The refusal is enforced
 * here on the server, not in the UI, so a direct API call that skips the
 * interface is refused identically.
 *
 * ── Unfreezing ──────────────────────────────────────────────────────────────
 * Immediate and automatic. The moment the owner is back within their limit —
 * upgraded, or deleted enough other bands — the next touch clears `frozen_at`
 * and `frozen_reason`. There is nothing to click and nothing to wait for.
 */

import { supabase } from '@/lib/supabase'
import {
  getBandOwnerId,
  getEffectiveEntitlements,
  listOwnedBands,
  resolvePlanState,
} from '@/lib/entitlements'
import { splitBandsForFreeze } from '@/lib/freezeOrder'
import { checkPlanConflicts } from '@/lib/planConflicts'

export const FROZEN_REASON_PLAN_DOWNGRADE = 'plan_downgrade'

export interface BandFreezeState {
  frozen: boolean
  frozenAt: string | null
  frozenReason: string | null
}

const NOT_FROZEN: BandFreezeState = { frozen: false, frozenAt: null, frozenReason: null }

function isMissingSchema(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205'
}

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Current stored freeze state. Does NOT re-evaluate — use
 * {@link ensureBandFreezeState} on request paths.
 */
export async function getBandFreezeState(bandId: string): Promise<BandFreezeState> {
  const { data, error } = await supabase
    .from('bands')
    .select('frozen_at, frozen_reason')
    .eq('id', bandId)
    .maybeSingle()

  if (error) {
    // Columns absent (migration not applied) — nothing can be frozen yet.
    if (isMissingSchema(error)) return NOT_FROZEN
    throw error
  }
  if (!data) return NOT_FROZEN

  const frozenAt = typeof data.frozen_at === 'string' ? data.frozen_at : null
  return {
    frozen: frozenAt !== null,
    frozenAt,
    frozenReason: typeof data.frozen_reason === 'string' ? data.frozen_reason : null,
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

async function setFrozen(bandIds: string[], reason: string): Promise<void> {
  if (!bandIds.length) return
  const { error } = await supabase
    .from('bands')
    .update({ frozen_at: new Date().toISOString(), frozen_reason: reason })
    .in('id', bandIds)
    .is('frozen_at', null)
  if (error && !isMissingSchema(error)) throw error
}

async function clearFrozen(bandIds: string[]): Promise<void> {
  if (!bandIds.length) return
  const { error } = await supabase
    .from('bands')
    .update({ frozen_at: null, frozen_reason: null })
    .in('id', bandIds)
    .not('frozen_at', 'is', null)
  if (error && !isMissingSchema(error)) throw error
}

// ── Lazy evaluation ──────────────────────────────────────────────────────────

/**
 * Resolve — and if necessary apply — this band's freeze state.
 *
 * Returns the state as of now. Safe to call on every request; see the header
 * for the cost profile.
 */
export async function ensureBandFreezeState(bandId: string): Promise<BandFreezeState> {
  const current = await getBandFreezeState(bandId)

  const ownerId = await getBandOwnerId(bandId)
  // An ownerless band cannot be charged to anyone's plan. Leave it as it is.
  if (!ownerId) return current

  const state = await resolvePlanState(ownerId)

  // Fast path: not frozen and not past grace — nothing can change here.
  if (!current.frozen && state.state !== 'enforced') return current

  const result = await reconcileOwnerBands(ownerId, state.state === 'enforced')
  return result.get(bandId) ?? current
}

/**
 * Bring every band an owner owns into agreement with their entitlements.
 *
 * @param enforce true when grace has expired (freeze the excess); false means
 *                the account is active or still in grace, so nothing should be
 *                frozen for a plan reason and anything that is gets released.
 */
export async function reconcileOwnerBands(
  ownerId: string,
  enforce: boolean,
): Promise<Map<string, BandFreezeState>> {
  const [entitlements, owned, state] = await Promise.all([
    getEffectiveEntitlements(ownerId),
    listOwnedBands(ownerId),
    resolvePlanState(ownerId),
  ])

  const out = new Map<string, BandFreezeState>()

  // The plan system is not live yet — never freeze anything.
  if (!entitlements.provisioned) {
    for (const b of owned) out.set(b.id, NOT_FROZEN)
    return out
  }

  const split = splitBandsForFreeze(owned, state.keepBandIds, entitlements.bandsOwned)

  const toFreeze = enforce
    ? split.freeze.filter(b => !b.frozenAt).map(b => b.id)
    : []

  // Anything frozen for a plan reason that is now inside the keep set (or that
  // should not be frozen at all) comes back immediately.
  const releaseSet = enforce ? split.keep : owned
  const toUnfreeze = releaseSet
    .filter(b => b.frozenAt && b.frozenReason === FROZEN_REASON_PLAN_DOWNGRADE)
    .map(b => b.id)

  await Promise.all([setFrozen(toFreeze, FROZEN_REASON_PLAN_DOWNGRADE), clearFrozen(toUnfreeze)])

  const frozenNow = new Set(
    enforce ? split.freeze.map(b => b.id) : [],
  )

  for (const b of owned) {
    const stillFrozenForOtherReason =
      b.frozenAt && b.frozenReason !== FROZEN_REASON_PLAN_DOWNGRADE
    if (stillFrozenForOtherReason) {
      out.set(b.id, { frozen: true, frozenAt: b.frozenAt, frozenReason: b.frozenReason })
      continue
    }
    out.set(
      b.id,
      frozenNow.has(b.id)
        ? {
            frozen: true,
            frozenAt: b.frozenAt ?? new Date().toISOString(),
            frozenReason: FROZEN_REASON_PLAN_DOWNGRADE,
          }
        : NOT_FROZEN,
    )
  }

  // Grace is over the moment the data fits the plan again. Clearing the column
  // is what returns the account to 'active' — the state is derived from it, so
  // leaving a stale deadline behind would keep showing an expired banner.
  if (state.graceUntil) {
    const remaining = await checkPlanConflicts(ownerId, state.plan)
    if (remaining.length === 0) await clearGrace(ownerId)
  }

  return out
}

/** Clear the grace deadline and the user's keep-choice. */
export async function clearGrace(userId: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ grace_until: null, grace_keep_band_ids: null })
    .eq('id', userId)
  if (error && !isMissingSchema(error)) throw error
}

// ── The write block ──────────────────────────────────────────────────────────

export class BandFrozenError extends Error {
  readonly bandId: string
  readonly reason: string

  constructor(bandId: string, reason: string) {
    super('band_frozen')
    this.name = 'BandFrozenError'
    this.bandId = bandId
    this.reason = reason
  }
}

export function isBandFrozenError(err: unknown): err is BandFrozenError {
  return err instanceof BandFrozenError
}

/** 403 — same status as every other "allowed here, not allowed to do that". */
export const BAND_FROZEN_STATUS = 403

export interface BandFrozenBody {
  error: 'band_frozen'
  band_id: string
  reason: string
}

export function bandFrozenBody(err: BandFrozenError): BandFrozenBody {
  return { error: 'band_frozen', band_id: err.bandId, reason: err.reason }
}

/**
 * Refuse if the band is frozen. Call before any write that targets a band.
 * Most routes get this for free through the auth guards — see
 * `requireBandMember` — so only paths that bypass those need it directly.
 */
export async function assertBandWritable(bandId: string): Promise<void> {
  const state = await ensureBandFreezeState(bandId)
  if (state.frozen) {
    throw new BandFrozenError(bandId, state.frozenReason ?? FROZEN_REASON_PLAN_DOWNGRADE)
  }
}

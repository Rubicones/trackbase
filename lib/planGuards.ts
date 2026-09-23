/**
 * Server-side enforcement helpers.
 *
 * Every limit in this app is enforced here, on the server. The client may
 * *display* a limit; it may never assert one. Assume the client is hostile:
 * identity comes from the session, limits come from the database, and nothing
 * in a request body is trusted — not a band id's owner, not a count, not a
 * plan, not a feature flag.
 *
 * Each guard either returns quietly or throws `LimitReachedError`, whose body
 * is the structured refusal the UI renders a specific message from:
 *
 *   { error: 'limit_reached', limit_type, limit, current }
 *
 * Route handlers translate that with `limitRefusalResponse()` rather than
 * letting it fall through to a generic 500 — a user who hits a ceiling must be
 * told which ceiling and what would lift it, never "Internal server error".
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { mbToBytes, withinLimit, type GatedFeature } from '@/lib/plans'
import {
  LimitReachedError,
  LIMIT_REACHED_STATUS,
  countActiveVersions,
  countBandMembers,
  getBandEntitlements,
  isLimitReachedError,
} from '@/lib/entitlements'
import { getBandStorageUsed } from '@/lib/bandStorage'
import {
  BAND_FROZEN_STATUS,
  BandFrozenError as BandFrozenErrorCtor,
  bandFrozenBody,
  ensureBandFreezeState,
  isBandFrozenError,
} from '@/lib/bandFreeze'

// ── Members ──────────────────────────────────────────────────────────────────

/**
 * Refuse if adding one more member would take the band past its ceiling.
 *
 * The ceiling comes from the BAND OWNER's plan (plus that band's
 * `extra_member` addons), never from the acting user's plan — a free member
 * approving a join request in a Band+ owner's band is not restricted by free.
 *
 * Call this from every path that inserts into `band_members`: approving a join
 * request, accepting a legacy token invite, and anything added later.
 */
export async function assertCanAddMember(bandId: string): Promise<void> {
  const entitlements = await getBandEntitlements(bandId)
  if (!entitlements.provisioned) return

  const limit = entitlements.membersPerBand
  if (limit === null) return

  const current = await countBandMembers(bandId)
  if (!withinLimit(limit, current + 1)) {
    throw new LimitReachedError({ limit_type: 'members', limit, current, band_id: bandId })
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface StorageQuota {
  used: number
  /** Bytes, or null for unlimited. */
  limit: number | null
}

/** The band's resolved storage ceiling in bytes, and what it is using now. */
export async function getBandStorageQuota(bandId: string): Promise<StorageQuota> {
  const entitlements = await getBandEntitlements(bandId)
  const [used] = await Promise.all([getBandStorageUsed(supabase, bandId)])
  return { used, limit: mbToBytes(entitlements.storagePerBandMB) }
}

/**
 * Refuse if the band's current usage plus `additionalBytes` would exceed its
 * ceiling. Storage is per band: nothing here reads or sums the owner's other
 * bands.
 */
export async function assertStorageHeadroom(
  bandId: string,
  additionalBytes: number,
): Promise<StorageQuota> {
  const quota = await getBandStorageQuota(bandId)
  if (quota.limit === null) return quota

  if (quota.used + additionalBytes > quota.limit) {
    throw new LimitReachedError({
      limit_type: 'storage',
      limit: quota.limit,
      current: quota.used,
      band_id: bandId,
    })
  }
  return quota
}

/**
 * Route-handler shorthand for the upload paths.
 *
 * Returns the refusal response when the incoming bytes would not fit, or null
 * when they would:
 *
 *   const over = await storageRefusal(bandId, fileSize)
 *   if (over) return over
 *
 * Kept as a returned response rather than a throw because the upload routes are
 * long, linear, and mostly not wrapped in try/catch — a throw here would land
 * in a generic 500 handler and lose the reason.
 */
export async function storageRefusal(
  bandId: string,
  additionalBytes: number,
): Promise<NextResponse | null> {
  try {
    await assertStorageHeadroom(bandId, additionalBytes)
    return null
  } catch (err) {
    const refusal = limitRefusalResponse(err)
    if (refusal) return refusal
    throw err
  }
}

/** The resolved ceiling for a band, in bytes. Null means unlimited. */
export async function resolveBandStorageLimitBytes(bandId: string): Promise<number | null> {
  const entitlements = await getBandEntitlements(bandId)
  return mbToBytes(entitlements.storagePerBandMB)
}

// ── Versions ─────────────────────────────────────────────────────────────────

/**
 * Refuse if the project already holds its maximum of active versions.
 *
 * "Active" is an unapplied branch. Master never counts — it is not a working
 * copy the user can be asked to give up — and neither does a branch that has
 * already been applied.
 */
export async function assertCanCreateVersion(projectId: string, bandId: string): Promise<void> {
  const entitlements = await getBandEntitlements(bandId)
  if (!entitlements.provisioned) return

  const limit = entitlements.activeVersionsPerProject
  if (limit === null) return

  const current = await countActiveVersions(projectId)
  if (!withinLimit(limit, current + 1)) {
    throw new LimitReachedError({ limit_type: 'versions', limit, current, band_id: bandId })
  }
}

// ── Gated features ───────────────────────────────────────────────────────────

/**
 * Refuse if the band's plan does not include `feature`.
 *
 * Hiding the button is not enforcement. Any server endpoint that does the work
 * of a gated feature calls this, so a direct API call with the UI bypassed is
 * refused identically.
 *
 * Resolved from the BAND's entitlements, so every member of a paid band can
 * use the paid features of that band regardless of their own plan — which is
 * the whole point of paying for a band rather than a seat.
 */
export async function assertBandFeature(bandId: string, feature: GatedFeature): Promise<void> {
  const entitlements = await getBandEntitlements(bandId)
  if (!entitlements.provisioned) return

  if (!entitlements.features.includes(feature)) {
    throw new LimitReachedError({ limit_type: 'feature', limit: null, current: 0, feature, band_id: bandId })
  }
}

// ── Frozen bands ─────────────────────────────────────────────────────────────

/**
 * Route-handler shorthand for band-level writes.
 *
 * Project-scoped routes inherit the frozen block from `requireBandMember`,
 * which keys off the HTTP method. Band-level routes (chat, members, invite
 * codes, renaming) authenticate through `assertBandMember` / `assertBandOwner`
 * instead — those take no request — so they call this explicitly:
 *
 *   const frozen = await frozenBandRefusal(bandId)
 *   if (frozen) return frozen
 */
export async function frozenBandRefusal(bandId: string): Promise<NextResponse | null> {
  const state = await ensureBandFreezeState(bandId)
  if (!state.frozen) return null
  return NextResponse.json(
    bandFrozenBody(new BandFrozenErrorCtor(bandId, state.frozenReason ?? 'plan_downgrade')),
    { status: BAND_FROZEN_STATUS },
  )
}

// ── Response translation ─────────────────────────────────────────────────────

/**
 * Turn a guard's throw into the response the UI expects, or null when the
 * error is something else and should keep propagating.
 *
 * Usage in a route handler:
 *
 *   catch (err) {
 *     const refusal = limitRefusalResponse(err)
 *     if (refusal) return refusal
 *     ...
 *   }
 */
export function limitRefusalResponse(err: unknown): NextResponse | null {
  if (isLimitReachedError(err)) {
    return NextResponse.json(err.body, { status: LIMIT_REACHED_STATUS })
  }
  if (isBandFrozenError(err)) {
    return NextResponse.json(bandFrozenBody(err), { status: BAND_FROZEN_STATUS })
  }
  return null
}

/**
 * Plan conflict detection.
 *
 * One function, `checkPlanConflicts(userId, targetPlan)`, used by three
 * callers that must agree:
 *
 *   · the UPGRADE flow — to block the switch until the user has resolved the
 *     conflicts an upgrade cannot resolve for them
 *   · the DOWNGRADE flow — to decide whether a grace period is needed at all
 *   · state resolution   — to answer "does this account still have conflicts?"
 *     when grace expires, and to know when it is safe to end grace early
 *
 * A conflict is always "the data exceeds what the target plan allows". It is
 * never a judgement about whether the change is a good idea.
 *
 * Everything here reads the database. Nothing trusts a request body, and the
 * target plan is validated by the caller before it gets this far.
 */

import { supabase } from '@/lib/supabase'
import {
  bytesToMB,
  withinLimit,
  type Limit,
  type PlanId,
} from '@/lib/plans'
import {
  countActiveVersions,
  countBandMembers,
  getBandEntitlementsForPlan,
  getEntitlementsForPlan,
  listOwnedBands,
  readPlanProfile,
  type OwnedBandSummary,
} from '@/lib/entitlements'
import { splitBandsForFreeze } from '@/lib/freezeOrder'

// ── Conflict shapes ──────────────────────────────────────────────────────────

export interface BandConflictInfo {
  id: string
  name: string
  lastActivityAt: string
  storageBytes: number
  memberCount: number
}

export interface ConflictMember {
  userId: string
  username: string | null
  displayName: string | null
  role: string
  joinedAt: string | null
}

export interface TooManyBandsConflict {
  type: 'too_many_bands'
  current: number
  limit: number
  /** The bands that would be frozen — least recently active first. */
  bands: BandConflictInfo[]
  /** Every owned band, most recently active first, so the user can choose. */
  allBands: BandConflictInfo[]
}

export interface TooManyMembersConflict {
  type: 'too_many_members'
  bandId: string
  bandName: string
  current: number
  limit: number
  members: ConflictMember[]
}

export interface StorageExceededConflict {
  type: 'storage_exceeded'
  bandId: string
  bandName: string
  currentMB: number
  limitMB: number
}

export interface VersionsExceededConflict {
  type: 'versions_exceeded'
  projectId: string
  projectName: string
  bandId: string
  current: number
  limit: number
}

export type Conflict =
  | TooManyBandsConflict
  | TooManyMembersConflict
  | StorageExceededConflict
  | VersionsExceededConflict

export type ConflictType = Conflict['type']

/**
 * Conflicts the USER must clear before an upgrade is allowed.
 *
 * Only `too_many_members` is blocking, and only because an upgrade can lower
 * that ceiling (Free's 3 → Solo's 2) while raising everything else. Bands,
 * storage and versions only ever go up on an upgrade, so they resolve
 * themselves the moment the plan changes and there is nothing to ask of the
 * user.
 *
 * Members are people. The app will not remove one to make an upgrade
 * convenient — the user does it deliberately, or the upgrade does not happen.
 */
export const BLOCKING_CONFLICT_TYPES: readonly ConflictType[] = ['too_many_members'] as const

export function isBlockingConflict(conflict: Conflict): boolean {
  return BLOCKING_CONFLICT_TYPES.includes(conflict.type)
}

/** Structural conflicts are the ones a grace period exists for. */
export function hasStructuralConflicts(conflicts: Conflict[]): boolean {
  return conflicts.length > 0
}

// ── The checker ──────────────────────────────────────────────────────────────

function toInfo(b: OwnedBandSummary): BandConflictInfo {
  return {
    id: b.id,
    name: b.name,
    lastActivityAt: b.lastActivityAt,
    storageBytes: b.storageBytes,
    memberCount: b.memberCount,
  }
}

/**
 * Compare the user's actual data against `targetPlan`.
 *
 * Scope: the user's OWNED bands only. Bands they are merely a member of are
 * governed by their owner's plan and are none of this user's business — a
 * downgrade must never create a conflict inside somebody else's band.
 */
export async function checkPlanConflicts(
  userId: string,
  targetPlan: PlanId,
): Promise<Conflict[]> {
  const conflicts: Conflict[] = []

  const [target, owned, profile] = await Promise.all([
    getEntitlementsForPlan(userId, targetPlan),
    listOwnedBands(userId),
    readPlanProfile(userId),
  ])

  // Legacy mode (migration not applied): the plan system is inert, so there is
  // nothing to conflict with. See the header of lib/entitlements.ts.
  if (!target.provisioned) return conflicts

  // ── 1. Owned bands ────────────────────────────────────────────────────────
  if (!withinLimit(target.bandsOwned, owned.length) && target.bandsOwned !== null) {
    const split = splitBandsForFreeze(owned, profile?.keepBandIds ?? [], target.bandsOwned)
    conflicts.push({
      type: 'too_many_bands',
      current: owned.length,
      limit: target.bandsOwned,
      bands: split.freeze.map(toInfo),
      allBands: [...split.keep, ...split.freeze.slice().reverse()].map(toInfo),
    })
  }

  // ── 2. Per-band members and storage ───────────────────────────────────────
  // Resolved per band, because band-scoped addons (extra_member,
  // extra_storage) change the answer band by band. Storage is never pooled:
  // each band is compared against its own ceiling and nothing is summed.
  for (const band of owned) {
    const bandTarget = await getBandEntitlementsForPlan(userId, band.id, targetPlan)

    if (!withinLimit(bandTarget.membersPerBand, band.memberCount) && bandTarget.membersPerBand !== null) {
      conflicts.push({
        type: 'too_many_members',
        bandId: band.id,
        bandName: band.name,
        current: band.memberCount,
        limit: bandTarget.membersPerBand,
        members: await listBandMembers(band.id),
      })
    }

    const usedMB = bytesToMB(band.storageBytes)
    if (!withinLimit(bandTarget.storagePerBandMB, usedMB) && bandTarget.storagePerBandMB !== null) {
      conflicts.push({
        type: 'storage_exceeded',
        bandId: band.id,
        bandName: band.name,
        currentMB: Math.round(usedMB),
        limitMB: bandTarget.storagePerBandMB,
      })
    }
  }

  // ── 3. Active versions per project ────────────────────────────────────────
  if (target.activeVersionsPerProject !== null && owned.length) {
    const limit = target.activeVersionsPerProject
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, band_id')
      .in('band_id', owned.map(b => b.id))

    for (const project of (projects ?? []) as { id: string; name: string; band_id: string }[]) {
      const current = await countActiveVersions(project.id)
      if (!withinLimit(limit, current)) {
        conflicts.push({
          type: 'versions_exceeded',
          projectId: project.id,
          projectName: project.name,
          bandId: project.band_id,
          current,
          limit,
        })
      }
    }
  }

  return conflicts
}

/**
 * Members of a band, with enough identity for the resolution screen to show
 * who the user is about to remove. Owner first, then most recently joined —
 * the owner can never be the one removed, so listing them first makes the
 * "you can't remove yourself" state obvious rather than surprising.
 */
export async function listBandMembers(bandId: string): Promise<ConflictMember[]> {
  const { data: members } = await supabase
    .from('band_members')
    .select('user_id, role, joined_at')
    .eq('band_id', bandId)

  const rows = (members ?? []) as { user_id: string; role: string; joined_at: string | null }[]
  if (!rows.length) return []

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', rows.map(r => r.user_id))

  const byId = new Map(
    ((profiles ?? []) as { id: string; username: string | null; display_name: string | null }[])
      .map(p => [p.id, p]),
  )

  return rows
    .map(r => ({
      userId: r.user_id,
      username: byId.get(r.user_id)?.username ?? null,
      displayName: byId.get(r.user_id)?.display_name ?? null,
      role: r.role,
      joinedAt: r.joined_at,
    }))
    .sort((a, b) => {
      if (a.role === 'owner' && b.role !== 'owner') return -1
      if (b.role === 'owner' && a.role !== 'owner') return 1
      return (b.joinedAt ?? '').localeCompare(a.joinedAt ?? '')
    })
}

/** Convenience for the count-based checks that do not need the full shapes. */
export async function bandMemberCount(bandId: string): Promise<number> {
  return countBandMembers(bandId)
}

/** Limit helper re-exported so callers do not reach past this module. */
export type { Limit }

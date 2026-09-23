/**
 * Which bands survive a downgrade, and which get frozen.
 *
 * Pure — no database, no dates beyond the strings it is handed — so the
 * decision can be shown to the user during grace (the downgrade screen) and
 * then applied at the end of grace (the freezer) with a guarantee that both
 * arrive at the same answer. Two implementations of this rule would drift, and
 * the user would be shown one outcome and given another.
 *
 * The rule, in order:
 *   1. The user's explicit choice wins. Bands they picked to keep are kept,
 *      in the order they picked them, up to the limit.
 *   2. Remaining slots go to the most recently active bands.
 *   3. Everything left over is a freeze candidate, least recently active first
 *      — so the list reads as "these are the ones you're about to lose", worst
 *      case at the top.
 *
 * An unlimited limit (`null`) keeps everything: there is nothing to freeze.
 */

import type { Limit } from '@/lib/plans'

export interface FreezeCandidate {
  id: string
  lastActivityAt: string
}

export interface FreezeSplit<T extends FreezeCandidate> {
  /** Bands that stay usable, most recently active first. */
  keep: T[]
  /** Bands that would be (or are) frozen, least recently active first. */
  freeze: T[]
}

/** Most recently active first. Ties break on id so the order is stable. */
function byActivityDesc<T extends FreezeCandidate>(a: T, b: T): number {
  const ta = Date.parse(a.lastActivityAt)
  const tb = Date.parse(b.lastActivityAt)
  const va = Number.isNaN(ta) ? 0 : ta
  const vb = Number.isNaN(tb) ? 0 : tb
  if (va !== vb) return vb - va
  return a.id.localeCompare(b.id)
}

/**
 * Split owned bands into keep / freeze.
 *
 * @param bands       every band the user owns
 * @param keepBandIds the user's explicit choice, made during grace (may be
 *                    empty, stale, over-long, or contain ids they no longer
 *                    own — all of which are tolerated and cleaned up here)
 * @param limit       the effective owned-bands limit, `null` for unlimited
 */
export function splitBandsForFreeze<T extends FreezeCandidate>(
  bands: T[],
  keepBandIds: string[],
  limit: Limit,
): FreezeSplit<T> {
  const sorted = [...bands].sort(byActivityDesc)

  if (limit === null || sorted.length <= limit) {
    return { keep: sorted, freeze: [] }
  }

  const byId = new Map(sorted.map(b => [b.id, b]))
  const keep: T[] = []
  const claimed = new Set<string>()

  // 1. Honour the explicit choice, ignoring ids that are no longer owned.
  for (const id of keepBandIds) {
    if (keep.length >= limit) break
    const band = byId.get(id)
    if (!band || claimed.has(id)) continue
    keep.push(band)
    claimed.add(id)
  }

  // 2. Fill the remaining slots with the most recently active.
  for (const band of sorted) {
    if (keep.length >= limit) break
    if (claimed.has(band.id)) continue
    keep.push(band)
    claimed.add(band.id)
  }

  // 3. The rest are candidates, least recently active first.
  const freeze = sorted.filter(b => !claimed.has(b.id)).reverse()

  return { keep, freeze }
}

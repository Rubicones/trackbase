/**
 * How an add-on subscription item is split across bands.
 *
 * ⚠ SERVER ONLY (it is only ever handed Stripe objects), but pure: no I/O.
 *
 * ── Why the split lives in metadata ─────────────────────────────────────────
 * Stripe refuses two items with the same price on one subscription ("Cannot
 * add multiple subscription items with the same plan"). The previous model —
 * one item per (price, band) — therefore could never sell Extra storage to a
 * second band: the second `subscriptionItems.create` was rejected and the user
 * got a 500. So there is ONE item per add-on price, its `quantity` is the
 * total, and its metadata says how many of those units each band holds:
 *
 *     b_<band uuid without hyphens>: "<units>"
 *
 * 34-character keys (Stripe's key limit is 40) and up to 49 bands per item
 * (Stripe allows 50 keys). `extra_band` is account-wide and carries no split.
 *
 * Items written before this change carry `band_id: <uuid>` and hold all of
 * their quantity on that band; they are read as exactly that, and rewritten
 * into the new shape the next time anything changes them.
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * Units the metadata does not place on a band grant nothing. That is the
 * state between a paid pending update landing (quantity already raised) and
 * the webhook writing the split — a gap of one request, and a gap that errs
 * towards "not yet" rather than towards capacity nobody chose a band for.
 */

import type Stripe from 'stripe'

export type Allocations = Map<string, number>

const KEY_PREFIX = 'b_'
const UUID_HEX = /^[0-9a-f]{32}$/i

export function allocationKey(bandId: string): string {
  return KEY_PREFIX + bandId.replace(/-/g, '').toLowerCase()
}

function bandIdFromKey(key: string): string | null {
  if (!key.startsWith(KEY_PREFIX)) return null
  const hex = key.slice(KEY_PREFIX.length)
  if (!UUID_HEX.test(hex)) return null
  const h = hex.toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function positiveInt(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** The item's split, exactly as its metadata states it (legacy shape included). */
export function readAllocations(
  item: Pick<Stripe.SubscriptionItem, 'metadata' | 'quantity'> | null | undefined,
): Allocations {
  const out: Allocations = new Map()
  if (!item) return out
  const metadata = item.metadata ?? {}

  for (const [key, value] of Object.entries(metadata)) {
    const bandId = bandIdFromKey(key)
    const units = positiveInt(value)
    if (bandId && units > 0) out.set(bandId, (out.get(bandId) ?? 0) + units)
  }

  // Legacy: one item per band, the whole quantity on `band_id`.
  if (out.size === 0 && typeof metadata.band_id === 'string' && metadata.band_id) {
    const units = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 0
    if (units > 0) out.set(metadata.band_id, units)
  }
  return out
}

/**
 * The split the sync may actually grant: never more units than the item has.
 *
 * Only reachable through a hand edit in the dashboard or a half-applied change;
 * the answer is deterministic (bands in id order) so two syncs never disagree
 * about which band lost the excess.
 */
export function clampAllocations(allocations: Allocations, quantity: number): Allocations {
  let left = Math.max(0, quantity)
  const out: Allocations = new Map()
  for (const bandId of [...allocations.keys()].sort()) {
    if (left <= 0) break
    const units = Math.min(allocations.get(bandId) ?? 0, left)
    if (units > 0) {
      out.set(bandId, units)
      left -= units
    }
  }
  return out
}

/**
 * Metadata that REPLACES the split with `target`.
 *
 * Stripe merges metadata, so bands that drop to zero are unset explicitly
 * (empty string), and the legacy `band_id` key is always cleared — leaving it
 * would make `readAllocations` see two shapes at once.
 */
export function allocationMetadata(
  current: Stripe.Metadata | null | undefined,
  target: Allocations,
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const key of Object.keys(current ?? {})) {
    if (bandIdFromKey(key)) patch[key] = ''
  }
  if (current && 'band_id' in current) patch.band_id = ''
  for (const [bandId, units] of target) {
    if (units > 0) patch[allocationKey(bandId)] = String(units)
  }
  return patch
}

export function sumAllocations(allocations: Allocations): number {
  let total = 0
  for (const units of allocations.values()) total += units
  return total
}

export function allocationsToJson(allocations: Allocations): Record<string, number> {
  return Object.fromEntries(allocations)
}

export function allocationsFromJson(value: unknown): Allocations {
  const out: Allocations = new Map()
  if (value && typeof value === 'object') {
    for (const [bandId, units] of Object.entries(value as Record<string, unknown>)) {
      const n = positiveInt(units)
      if (n > 0) out.set(bandId, n)
    }
  }
  return out
}

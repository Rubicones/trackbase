/**
 * Subscription plans — THE single source of truth for limits, features and
 * prices.
 *
 * Every limit check in the application, server or client, resolves back to the
 * `PLANS` table below. **Never write a plan number anywhere else.** A literal
 * `3` or `500` in a route handler is a bug: it will drift the day a plan
 * changes, and it will drift silently, because there is no test suite here to
 * catch it (AGENTS.md §7).
 *
 * ── Where a plan value comes from ───────────────────────────────────────────
 * `profiles.plan` holds the plan id. Today it is written by the dev switcher
 * (`/api/dev/plan`); when Stripe arrives it will write exactly the same column
 * and insert `plan_addons` rows, and nothing in this file or in
 * `lib/entitlements.ts` needs to know the difference. That seam is deliberate:
 * no code below may read a Stripe id, a subscription status, or a price.
 *
 * ── Unlimited ───────────────────────────────────────────────────────────────
 * `null` means unlimited, not `Infinity`. `Infinity` does not survive
 * `JSON.stringify` (it serialises to `null` anyway, but only after silently
 * passing through `number` type checks first), so the wire format and the
 * in-memory format are kept identical on purpose. Use `withinLimit()` /
 * `remaining()` rather than comparing by hand.
 *
 * This module is isomorphic — it must stay free of server-only imports so the
 * plans modal and the preferences panel can render prices and limits from the
 * same constant the server enforces.
 */

export type PlanId = 'free' | 'solo' | 'band' | 'band_plus'
export type PaidPlanId = Exclude<PlanId, 'free'>

/**
 * Gated feature keys.
 *
 * These are the same strings the pre-existing test paywall used
 * (`contexts/PaywallContext.tsx`), kept deliberately: they are referenced from
 * the mixer, the structure editor and the merge modal, and renaming them would
 * be churn with no behavioural payoff. `track_edit` is the "track editor"
 * feature (split / duplicate / copy / paste).
 */
export type GatedFeature = 'ab_compare' | 'track_edit' | 'chord_detect' | 'cherry_pick'

export const GATED_FEATURES: readonly GatedFeature[] = [
  'ab_compare',
  'track_edit',
  'chord_detect',
  'cherry_pick',
] as const

/** A numeric ceiling, or `null` for "no ceiling". */
export type Limit = number | null

export interface PlanDefinition {
  id: PlanId
  /** Display name. */
  name: string
  /** Display-only price string. There is no billing; nothing parses this. */
  price: string
  /** Bands the user may OWN. Membership of other people's bands is unlimited. */
  bandsOwned: Limit
  /** Members per band, resolved from the band OWNER's plan. */
  membersPerBand: Limit
  /** Storage per band, in megabytes. Never pooled across bands. */
  storagePerBandMB: Limit
  /** Unapplied versions per project, excluding Master. */
  activeVersionsPerProject: Limit
  /** Gated features unlocked by this plan. */
  features: readonly GatedFeature[]
}

const MB_PER_GB = 1024

/**
 * The plans.
 *
 * IMPORTANT — bands owned only. There is no cap of any kind on how many bands
 * a user may be a MEMBER of, on any plan, including free. Joining a bandmate's
 * space is always free. Do not add a `bandsJoined` field here; there is no
 * membership cap to express.
 *
 * IMPORTANT — storage is strictly per band. `storagePerBandMB` is the ceiling
 * for each band independently. A Band+ owner with five bands has 50 GB in each
 * of them, 250 GB in total, and there is no account-wide storage number
 * anywhere in this codebase. Do not sum it.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    price: '$0',
    bandsOwned: 1,
    membersPerBand: 3,
    storagePerBandMB: 500,
    activeVersionsPerProject: 3,
    features: [],
  },
  solo: {
    id: 'solo',
    name: 'Solo',
    price: '$6',
    bandsOwned: 1,
    membersPerBand: 2,
    storagePerBandMB: 10 * MB_PER_GB,
    activeVersionsPerProject: null,
    features: GATED_FEATURES,
  },
  band: {
    id: 'band',
    name: 'Band',
    price: '$9',
    bandsOwned: 3,
    membersPerBand: null,
    storagePerBandMB: 10 * MB_PER_GB,
    activeVersionsPerProject: null,
    features: GATED_FEATURES,
  },
  band_plus: {
    id: 'band_plus',
    name: 'Band+',
    price: '$15',
    bandsOwned: 5,
    membersPerBand: null,
    storagePerBandMB: 50 * MB_PER_GB,
    activeVersionsPerProject: null,
    features: GATED_FEATURES,
  },
}

/** Display order — free first, then ascending. Used by every plan surface. */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'solo', 'band', 'band_plus'] as const

export const DEFAULT_PLAN: PlanId = 'free'

/** Days of grace after a downgrade that created structural conflicts. */
export const GRACE_PERIOD_DAYS = 14

/** Addon kinds. Rows live in `plan_addons`; Stripe will insert them later. */
export type AddonType = 'extra_band' | 'extra_storage' | 'extra_member'

/** One `extra_storage` unit is +10 GB on the band it names. */
export const EXTRA_STORAGE_MB_PER_UNIT = 10 * MB_PER_GB

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Narrow an untrusted string (request body, DB column) to a known plan id. */
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS
}

/** Read a plan safely; anything unrecognised falls back to free (fail closed). */
export function planOf(value: unknown): PlanDefinition {
  return isPlanId(value) ? PLANS[value] : PLANS[DEFAULT_PLAN]
}

/** Rank for upgrade/downgrade direction. Higher = more capable. */
export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan)
}

export type PlanChangeDirection = 'upgrade' | 'downgrade' | 'none'

export function planChangeDirection(from: PlanId, to: PlanId): PlanChangeDirection {
  const delta = planRank(to) - planRank(from)
  return delta > 0 ? 'upgrade' : delta < 0 ? 'downgrade' : 'none'
}

/** True when `value` is allowed by `limit`. `null` (unlimited) always passes. */
export function withinLimit(limit: Limit, value: number): boolean {
  return limit === null || value <= limit
}

/** Headroom left under a limit, or `null` when unlimited. */
export function remaining(limit: Limit, current: number): Limit {
  return limit === null ? null : Math.max(0, limit - current)
}

/** Add to a limit, keeping `null` (unlimited) absorbing. */
export function addToLimit(limit: Limit, extra: number): Limit {
  return limit === null ? null : limit + extra
}

/** Format a megabyte figure the way the storage UI words it. */
export function formatMB(mb: Limit): string {
  if (mb === null) return 'Unlimited'
  if (mb >= MB_PER_GB) {
    const gb = mb / MB_PER_GB
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
  }
  return `${Math.round(mb)} MB`
}

/** Limits as a display list, used by the plans modal and preferences panel. */
export function planLimitLines(plan: PlanId): string[] {
  const p = PLANS[plan]
  return [
    p.bandsOwned === null
      ? 'Unlimited owned bands'
      : `${p.bandsOwned} owned band${p.bandsOwned === 1 ? '' : 's'}`,
    'Unlimited bands as a member',
    p.membersPerBand === null
      ? 'Unlimited members per band'
      : `Up to ${p.membersPerBand} members per band`,
    `${formatMB(p.storagePerBandMB)} storage per band`,
    p.activeVersionsPerProject === null
      ? 'Unlimited active versions'
      : `Up to ${p.activeVersionsPerProject} active versions per project`,
  ]
}

export const MB_IN_BYTES = 1024 * 1024

export function mbToBytes(mb: Limit): number | null {
  return mb === null ? null : mb * MB_IN_BYTES
}

export function bytesToMB(bytes: number): number {
  return bytes / MB_IN_BYTES
}

// ── Feature copy ─────────────────────────────────────────────────────────────

export const FEATURE_LABELS: Record<GatedFeature, string> = {
  ab_compare: 'A/B Compare',
  track_edit: 'Track editor',
  chord_detect: 'Chord auto-detect',
  cherry_pick: 'Cherry-pick and visual version diff',
}

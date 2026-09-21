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
 *
 * ⚠ THE FOUR ARE NOT ENFORCED THE SAME WAY. Two are server-enforced and two
 * cannot be, and the list below reads as homogeneous when it is not:
 *
 *   track_edit    → `POST /api/tracks/[id]/edit` calls `assertBandFeature()`
 *   cherry_pick   → `POST /api/projects/[id]/merge` calls it, when selective
 *                   fields are present (applying a whole version is free)
 *   ab_compare    → NO server endpoint. `components/CompareMode.tsx` is
 *                   client-side playback of two versions the user is already
 *                   entitled to read. There is nothing to refuse.
 *   chord_detect  → NO server endpoint. Detection runs entirely in a browser
 *                   worker (`public/workers/chordsWorker.js`, Essentia WASM).
 *                   The public `/tools/chord-detector` page is deliberately
 *                   ungated anyway — no login, marketing funnel, rate-limited.
 *
 * For the last two, the CLIENT CHECK IS THE ENFORCEMENT. `usePaywallGate()`
 * hides the entry point and that is all there is; anybody who can set a
 * JavaScript variable has the feature. Three consequences worth knowing before
 * touching any of this:
 *
 *   · A downgrade locks them on the next page load, not the next request —
 *     the plan snapshot is fetched once per `PaywallProvider` mount.
 *   · Passing `bandFeatures` to `usePaywallGate()` is load-bearing for these
 *     two, not cosmetic. Without it the gate falls back to the VIEWER's plan,
 *     and a free member of a paid band is denied outright with no server-side
 *     path to grant them. Every call site passes it.
 *   · "Add the missing server check" is not a patch. There is no server to
 *     check; making these paid in a stronger sense means moving the work, which
 *     is a product decision, not a bug fix.
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

// ── Limits as comparison rows ────────────────────────────────────────────────

export interface PlanLimitRow {
  label: string
  value: string
}

/**
 * Every limit a plan surface shows, as label/value pairs so the plan cards can
 * align them into a comparison table.
 *
 * This is the ONLY renderer of the limits. There used to be a sentence-form
 * one beside it, which is precisely the duplication the header of this file
 * warns about — two wordings of one rule, drifting apart one edit at a time.
 * A surface that needs a sentence composes it from these rows.
 *
 * Generated from `PLANS` because the modal used to list limits by hand and
 * they drifted — a "3 bands as a member" cap that
 * has never existed, and two different band counts for one plan. Wording a
 * limit anywhere other than this file is how that comes back.
 *
 * "Bands you join" is a row rather than a footnote because it is the single
 * most misread rule in the system, and a blank space where the other plans
 * show a number reads as "not included".
 */
export function planLimitRows(plan: PlanId): PlanLimitRow[] {
  const p = PLANS[plan]
  return [
    {
      label: 'Bands you own',
      value: p.bandsOwned === null ? 'Unlimited' : String(p.bandsOwned),
    },
    {
      label: 'Members / band',
      value: p.membersPerBand === null ? 'Unlimited' : String(p.membersPerBand),
    },
    { label: 'Storage / band', value: formatMB(p.storagePerBandMB) },
    {
      label: 'Active versions',
      value:
        p.activeVersionsPerProject === null
          ? 'Unlimited'
          : `${p.activeVersionsPerProject} / project`,
    },
    { label: 'Bands you join', value: 'Unlimited' },
  ]
}

// ── Addons ───────────────────────────────────────────────────────────────────

export interface AddonDefinition {
  type: AddonType
  name: string
  /** Display-only price string, same contract as `PlanDefinition.price`. */
  price: string
  /** What one unit grants, in the words the purchase card uses. */
  detail: string
  /**
   * True when the addon attaches to ONE band rather than the account. This is
   * not cosmetic: `plan_addons` has a CHECK constraint enforcing exactly this
   * split, because storage is never pooled across bands and "one more band" is
   * not a property of any single band.
   */
  bandScoped: boolean
}

export const ADDONS: Record<AddonType, AddonDefinition> = {
  extra_band: {
    type: 'extra_band',
    name: 'Extra band',
    price: '$5',
    detail: '+1 band you own, on top of your plan.',
    bandScoped: false,
  },
  extra_storage: {
    type: 'extra_storage',
    name: 'Extra storage',
    price: '$4',
    detail: `+${formatMB(EXTRA_STORAGE_MB_PER_UNIT)} of storage on one band.`,
    bandScoped: true,
  },
  extra_member: {
    type: 'extra_member',
    name: 'Extra member',
    price: '$2',
    detail: '+1 member on one band.',
    bandScoped: true,
  },
}

/** Display order for the addon cards. */
export const ADDON_ORDER: readonly AddonType[] = [
  'extra_band',
  'extra_storage',
  'extra_member',
] as const

export function isAddonType(value: unknown): value is AddonType {
  return typeof value === 'string' && value in ADDONS
}

// ── What a plan adds, and what it takes away ─────────────────────────────────

function limitIsGreater(a: Limit, b: Limit): boolean {
  if (a === null) return b !== null
  if (b === null) return false
  return a > b
}

/**
 * The "everything in X, plus:" bullets, derived by diffing this plan against
 * the one below it in {@link PLAN_ORDER}.
 *
 * Hand-written bullets are how a pricing card starts lying. The previous
 * version of the plans modal listed "Unlimited band members" under Band and
 * "50 GB storage per band" under Band+ as prose, so a change to `PLANS` left
 * the card advertising the old numbers with nothing to catch it. Every line
 * here is computed from the table the server enforces, so it cannot drift.
 *
 * Free returns nothing: there is no plan below it to improve on.
 */
export function planUpgradeHighlights(plan: PlanId): string[] {
  const index = PLAN_ORDER.indexOf(plan)
  if (index <= 0) return []

  const current = PLANS[plan]
  const previous = PLANS[PLAN_ORDER[index - 1]]
  const lines: string[] = []

  for (const feature of current.features) {
    if (!previous.features.includes(feature)) lines.push(FEATURE_LABELS[feature])
  }

  if (limitIsGreater(current.bandsOwned, previous.bandsOwned)) {
    lines.push(
      current.bandsOwned === null
        ? 'Unlimited bands of your own'
        : `Up to ${current.bandsOwned} bands you own`,
    )
  }

  if (limitIsGreater(current.membersPerBand, previous.membersPerBand)) {
    lines.push(
      current.membersPerBand === null
        ? 'Unlimited members per band'
        : `Up to ${current.membersPerBand} members per band`,
    )
  }

  if (limitIsGreater(current.storagePerBandMB, previous.storagePerBandMB)) {
    lines.push(`${formatMB(current.storagePerBandMB)} of storage per band`)
  }

  if (limitIsGreater(current.activeVersionsPerProject, previous.activeVersionsPerProject)) {
    lines.push(
      current.activeVersionsPerProject === null
        ? 'Unlimited active versions per project'
        : `Up to ${current.activeVersionsPerProject} active versions per project`,
    )
  }

  return lines
}

/**
 * Everything that gets SMALLER moving from one plan to another, in plain words.
 *
 * Most of the time this is empty for an upgrade — but not always, and the
 * exception is the whole reason this function exists. Free allows 3 members per
 * band and Solo allows 2, so paying for Solo *lowers* a ceiling. A user who
 * finds that out after paying has been misled by our own pricing card, and the
 * upgrade flow then refuses them (`too_many_members` is the one blocking
 * conflict) for a reason nothing warned them about.
 *
 * Used by the plans modal to caveat a card, and safe for the downgrade
 * confirmation too — the direction is not assumed anywhere below.
 */
export function planTradeoffs(from: PlanId, to: PlanId): string[] {
  const a = PLANS[from]
  const b = PLANS[to]
  const lines: string[] = []

  if (limitIsGreater(a.bandsOwned, b.bandsOwned)) {
    lines.push(
      `${b.name} covers ${b.bandsOwned} owned ${b.bandsOwned === 1 ? 'band' : 'bands'}, not ${
        a.bandsOwned === null ? 'unlimited' : a.bandsOwned
      }`,
    )
  }

  if (limitIsGreater(a.membersPerBand, b.membersPerBand)) {
    lines.push(
      `${b.name} allows ${b.membersPerBand} members per band, fewer than ${a.name}'s ${
        a.membersPerBand === null ? 'unlimited' : a.membersPerBand
      }`,
    )
  }

  if (limitIsGreater(a.storagePerBandMB, b.storagePerBandMB)) {
    lines.push(`Storage per band drops to ${formatMB(b.storagePerBandMB)}`)
  }

  if (limitIsGreater(a.activeVersionsPerProject, b.activeVersionsPerProject)) {
    lines.push(
      `Active versions per project drop to ${b.activeVersionsPerProject}, with Master still free`,
    )
  }

  const lost = a.features.filter(f => !b.features.includes(f))
  for (const feature of lost) lines.push(`${FEATURE_LABELS[feature]} locks`)

  return lines
}

/**
 * Entitlement resolution — the core of the plan system.
 *
 * `getEffectiveEntitlements(userId)` is the ONLY place a user's limits are
 * computed. Every enforcement point in the app calls it (or its band-scoped
 * sibling `getBandEntitlements`) and nothing computes a limit independently.
 * If you find yourself reading `profiles.plan` or `plan_addons` outside this
 * module, that is the bug.
 *
 * ── Resolution order ────────────────────────────────────────────────────────
 *   1. Base limits from `PLANS[profiles.plan]` (`lib/plans.ts`).
 *   2. Addons from `plan_addons`:
 *        extra_band     → +quantity owned bands, ACCOUNT-WIDE
 *        extra_storage  → +10 GB × quantity on the row's band_id ONLY
 *        extra_member   → +quantity members on the row's band_id ONLY
 *      A row with a band_id applies to that band alone; a row without one
 *      applies account-wide.
 *   3. `profiles.band_limit` is a MANUAL OVERRIDE, not an addition. When it is
 *      non-null it REPLACES the computed owned-bands limit outright — plan
 *      base and extra_band addons included. Null means "use the plan". This is
 *      how grandfathered beta accounts (and later B2B deals) keep an allowance
 *      their plan would not give them.
 *
 * ── Ownership ───────────────────────────────────────────────────────────────
 * A band's capabilities always come from its OWNER's plan; members inherit
 * them. A member's own plan governs only the bands they own themselves. So a
 * free user inside a Band+ owner's band is not restricted by free's limits,
 * and a Band+ user inside a free owner's band does not lift that band's
 * ceiling. Ownership is `band_members.role = 'owner'` everywhere, consistent
 * with `lib/bandAccess.ts` and the DB trigger.
 *
 * ── Membership is never capped ──────────────────────────────────────────────
 * There is no limit on how many bands a user may JOIN, on any plan. Nothing in
 * this file counts non-owner memberships, and nothing should.
 *
 * ── Before the migration runs ───────────────────────────────────────────────
 * SQL is applied manually by the project owner (AGENTS.md §5), so this code
 * ships before its columns exist. Every read here degrades to
 * `UNPROVISIONED`: the app behaves exactly as it did before the plan system —
 * legacy `band_limit` cap, legacy 1 GB storage, no feature gating, no
 * freezing. The migration is the switch that turns plans on. Failing *closed*
 * here would lock every user out of features they have today over a migration
 * that has not run yet, which is the worse failure.
 */

import { supabase } from '@/lib/supabase'
import {
  DEFAULT_PLAN,
  EXTRA_STORAGE_MB_PER_UNIT,
  GATED_FEATURES,
  GRACE_PERIOD_DAYS,
  PLANS,
  addToLimit,
  bytesToMB,
  isPlanId,
  type AddonType,
  type GatedFeature,
  type Limit,
  type PlanId,
} from '@/lib/plans'
import { BAND_STORAGE_LIMIT_BYTES, getBandStorageUsed } from '@/lib/bandStorage'
import { limitMessage, type LimitType } from '@/lib/planCopy'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Entitlements {
  plan: PlanId
  bandsOwned: Limit
  membersPerBand: Limit
  storagePerBandMB: Limit
  activeVersionsPerProject: Limit
  features: GatedFeature[]
  /**
   * False when the plan columns/tables are not in the database yet. Callers
   * that gate features should treat `false` as "do not gate" — see the header.
   */
  provisioned: boolean
  /** True when `profiles.band_limit` replaced the plan's owned-bands limit. */
  bandsOwnedOverridden: boolean
}

/** Derived, never stored. See `resolvePlanState`. */
export type PlanState = 'active' | 'grace' | 'enforced'

export interface AccountPlanState {
  state: PlanState
  plan: PlanId
  /** ISO timestamp, or null when no grace period is running. */
  graceUntil: string | null
  /** Whole days left in grace (0 when expired or not in grace). */
  graceDaysLeft: number
  /** Band ids the user asked to keep when the grace period ends. */
  keepBandIds: string[]
}

export interface OwnedBandSummary {
  id: string
  name: string
  /** ISO timestamp of the most recent activity, falling back to created_at. */
  lastActivityAt: string
  storageBytes: number
  memberCount: number
  frozenAt: string | null
  frozenReason: string | null
}

// ── Schema-presence detection ────────────────────────────────────────────────

/** Postgres: column / table / relation does not exist. */
const PG_UNDEFINED_COLUMN = '42703'
const PG_UNDEFINED_TABLE = '42P01'
/** PostgREST: could not find the table or column in the schema cache. */
const PGRST_SCHEMA_MISS = 'PGRST204'
const PGRST_NO_RELATION = 'PGRST205'

function isMissingSchema(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return (
    code === PG_UNDEFINED_COLUMN ||
    code === PG_UNDEFINED_TABLE ||
    code === PGRST_SCHEMA_MISS ||
    code === PGRST_NO_RELATION
  )
}

let warnedUnprovisioned = false
function warnUnprovisioned(where: string, err: unknown) {
  if (warnedUnprovisioned) return
  warnedUnprovisioned = true
  console.warn(
    `[entitlements] plan schema not present (${where}) — running in legacy mode. ` +
      'Apply supabase/migrations/20260806_subscription_plans.sql to enable plans.',
    err,
  )
}

/**
 * What the app looked like before plans existed. Used verbatim when the
 * migration has not been applied.
 */
function legacyEntitlements(bandLimit: number | null): Entitlements {
  return {
    plan: DEFAULT_PLAN,
    bandsOwned: bandLimit,
    membersPerBand: null,
    storagePerBandMB: bytesToMB(BAND_STORAGE_LIMIT_BYTES),
    activeVersionsPerProject: null,
    features: [...GATED_FEATURES],
    provisioned: false,
    bandsOwnedOverridden: bandLimit !== null,
  }
}

// ── Raw reads ────────────────────────────────────────────────────────────────

export interface PlanProfileRow {
  plan: PlanId
  bandLimit: number | null
  graceUntil: string | null
  keepBandIds: string[]
}

/**
 * Read the plan-bearing columns of a profile.
 * Returns null when the plan schema is absent (legacy mode).
 */
export async function readPlanProfile(userId: string): Promise<PlanProfileRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('plan, band_limit, grace_until, grace_keep_band_ids')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingSchema(error)) {
      warnUnprovisioned('profiles', error)
      return null
    }
    throw error
  }

  // No profile row at all: the account is mid-creation (the handle_new_user
  // trigger inserts it) or has been deleted. Treat as a default free account
  // rather than throwing — every caller here is a limit check, and free is the
  // most restrictive answer, so this fails closed.
  if (!data) return { plan: DEFAULT_PLAN, bandLimit: null, graceUntil: null, keepBandIds: [] }

  const row = data as {
    plan: unknown
    band_limit: unknown
    grace_until: unknown
    grace_keep_band_ids: unknown
  }

  return {
    plan: isPlanId(row.plan) ? row.plan : DEFAULT_PLAN,
    bandLimit: typeof row.band_limit === 'number' ? row.band_limit : null,
    graceUntil: typeof row.grace_until === 'string' ? row.grace_until : null,
    keepBandIds: Array.isArray(row.grace_keep_band_ids)
      ? (row.grace_keep_band_ids as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
  }
}

export interface AddonRow {
  id: string
  type: AddonType
  bandId: string | null
  quantity: number
}

/** Read a user's addons. Empty array when the table is absent. */
export async function readAddons(userId: string): Promise<AddonRow[]> {
  const { data, error } = await supabase
    .from('plan_addons')
    .select('id, addon_type, band_id, quantity')
    .eq('user_id', userId)

  if (error) {
    if (isMissingSchema(error)) {
      warnUnprovisioned('plan_addons', error)
      return []
    }
    throw error
  }

  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    type: r.addon_type as AddonType,
    bandId: typeof r.band_id === 'string' ? r.band_id : null,
    // A malformed quantity must not silently grant capacity.
    quantity: typeof r.quantity === 'number' && r.quantity > 0 ? Math.floor(r.quantity) : 0,
  }))
}

// ── The core resolver ────────────────────────────────────────────────────────

/**
 * Resolve a user's effective, account-wide entitlements.
 *
 * The per-band figures returned here (`membersPerBand`, `storagePerBandMB`)
 * are the plan's *base* values with account-wide addons applied. Band-scoped
 * addons cannot be represented in an account-wide answer, so any check about a
 * specific band must use {@link getBandEntitlements} instead — it resolves the
 * same plan plus that band's own addon rows.
 */
export async function getEffectiveEntitlements(userId: string): Promise<Entitlements> {
  const profile = await readPlanProfile(userId)
  if (!profile) {
    // Legacy mode: read the old non-null band_limit column on its own.
    const { data } = await supabase
      .from('profiles')
      .select('band_limit')
      .eq('id', userId)
      .maybeSingle()
    const legacyLimit = typeof data?.band_limit === 'number' ? data.band_limit : null
    return legacyEntitlements(legacyLimit)
  }

  const addons = await readAddons(userId)
  return resolveEntitlements(profile, addons, null)
}

/**
 * Pure resolution step, shared by the account-wide and band-scoped entry
 * points. `bandId` selects which band-scoped addons apply; pass null to apply
 * only the account-wide ones.
 */
function resolveEntitlements(
  profile: PlanProfileRow,
  addons: AddonRow[],
  bandId: string | null,
): Entitlements {
  const base = PLANS[profile.plan]

  let bandsOwned: Limit = base.bandsOwned
  let membersPerBand: Limit = base.membersPerBand
  let storagePerBandMB: Limit = base.storagePerBandMB

  for (const addon of addons) {
    if (addon.quantity <= 0) continue

    switch (addon.type) {
      case 'extra_band':
        // Account-wide by definition. A band_id on this row is meaningless —
        // "more bands" is not a property of one band — so it is ignored rather
        // than silently dropping the addon the user was granted.
        bandsOwned = addToLimit(bandsOwned, addon.quantity)
        break

      case 'extra_storage':
        // Band-scoped: only counts when we are resolving that exact band. An
        // account-wide storage addon (null band_id) would have nowhere to
        // land, since storage is never pooled — so it is ignored too.
        if (addon.bandId && addon.bandId === bandId) {
          storagePerBandMB = addToLimit(
            storagePerBandMB,
            EXTRA_STORAGE_MB_PER_UNIT * addon.quantity,
          )
        }
        break

      case 'extra_member':
        if (addon.bandId && addon.bandId === bandId) {
          membersPerBand = addToLimit(membersPerBand, addon.quantity)
        }
        break
    }
  }

  // The manual override REPLACES the computed value — it is not additive, and
  // it wins over extra_band addons too. Null means "use the plan".
  const bandsOwnedOverridden = profile.bandLimit !== null
  if (bandsOwnedOverridden) bandsOwned = profile.bandLimit

  return {
    plan: profile.plan,
    bandsOwned,
    membersPerBand,
    storagePerBandMB,
    activeVersionsPerProject: base.activeVersionsPerProject,
    features: [...base.features],
    provisioned: true,
    bandsOwnedOverridden,
  }
}

/**
 * Entitlements the user WOULD have on `plan`, keeping their addons and their
 * `band_limit` override. This is what the conflict checker compares the real
 * data against; it never writes anything and never changes the current plan.
 */
export async function getEntitlementsForPlan(
  userId: string,
  plan: PlanId,
): Promise<Entitlements> {
  const profile = await readPlanProfile(userId)
  if (!profile) return getEffectiveEntitlements(userId)
  const addons = await readAddons(userId)
  return resolveEntitlements({ ...profile, plan }, addons, null)
}

/** Band-scoped variant of {@link getEntitlementsForPlan}. */
export async function getBandEntitlementsForPlan(
  ownerId: string,
  bandId: string,
  plan: PlanId,
): Promise<Entitlements> {
  const profile = await readPlanProfile(ownerId)
  if (!profile) return getEffectiveEntitlements(ownerId)
  const addons = await readAddons(ownerId)
  return resolveEntitlements({ ...profile, plan }, addons, bandId)
}

// ── Band scope ───────────────────────────────────────────────────────────────

/** The owner of a band, via `band_members.role = 'owner'`. Null if none. */
export async function getBandOwnerId(bandId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', bandId)
    .eq('role', 'owner')
    .maybeSingle()
  if (error) throw error
  return data?.user_id ?? null
}

export interface BandEntitlements extends Entitlements {
  bandId: string
  ownerId: string | null
}

/**
 * Resolve a band's capabilities: the OWNER's plan plus that band's addons.
 * Members inherit this; their own plans are irrelevant here.
 *
 * A band with no owner row (data corruption, or an owner mid-deletion) falls
 * back to the free plan — the most restrictive answer, so an orphaned band
 * cannot become an unlimited one.
 */
export async function getBandEntitlements(bandId: string): Promise<BandEntitlements> {
  const ownerId = await getBandOwnerId(bandId)
  if (!ownerId) {
    return {
      ...resolveEntitlements(
        { plan: DEFAULT_PLAN, bandLimit: null, graceUntil: null, keepBandIds: [] },
        [],
        bandId,
      ),
      bandId,
      ownerId: null,
    }
  }

  const profile = await readPlanProfile(ownerId)
  if (!profile) {
    const { data } = await supabase
      .from('profiles')
      .select('band_limit')
      .eq('id', ownerId)
      .maybeSingle()
    const legacyLimit = typeof data?.band_limit === 'number' ? data.band_limit : null
    return { ...legacyEntitlements(legacyLimit), bandId, ownerId }
  }

  const addons = await readAddons(ownerId)
  return { ...resolveEntitlements(profile, addons, bandId), bandId, ownerId }
}

// ── Usage counters ───────────────────────────────────────────────────────────
// Every counter is a database read. None of them trusts a request body.

/** Bands the user OWNS. Bands they merely joined are not counted. */
export async function countOwnedBands(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('band_members')
    .select('band_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'owner')
  if (error) throw error
  return count ?? 0
}

/** Members of a band, owner included. */
export async function countBandMembers(bandId: string): Promise<number> {
  const { count, error } = await supabase
    .from('band_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('band_id', bandId)
  if (error) throw error
  return count ?? 0
}

/**
 * Active versions in a project: unapplied branches. Master (`type = 'main'`)
 * never counts toward the limit, and neither does a branch that has already
 * been applied (`merged_at` set) — it is history, not a live working copy.
 */
export async function countActiveVersions(projectId: string): Promise<number> {
  const { count, error } = await supabase
    .from('versions')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('type', 'branch')
    .is('merged_at', null)
  if (error) throw error
  return count ?? 0
}

/** Storage a band is currently using, in bytes (deduplicated by file_hash). */
export async function getBandStorageBytes(bandId: string): Promise<number> {
  return getBandStorageUsed(supabase, bandId)
}

// ── Owned-band inventory (for conflict UI and freezing) ──────────────────────

/**
 * Every band the user owns, with the signals the freeze decision and the
 * downgrade screen need: name, last activity, size, member count, frozen state.
 *
 * "Last activity" is the most recent `band_activity` row, falling back to the
 * band's creation date when the band has no activity yet. That fallback
 * matters: a brand-new empty band would otherwise sort as infinitely stale and
 * be the first thing frozen.
 */
export async function listOwnedBands(userId: string): Promise<OwnedBandSummary[]> {
  const { data: memberships, error } = await supabase
    .from('band_members')
    .select('band_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
  if (error) throw error

  const bandIds = (memberships ?? []).map((m: { band_id: string }) => m.band_id)
  if (!bandIds.length) return []

  const bandRows = await selectBands(bandIds)

  const [{ data: activity }, { data: members }] = await Promise.all([
    supabase
      .from('band_activity')
      .select('band_id, created_at')
      .in('band_id', bandIds)
      .order('created_at', { ascending: false }),
    supabase.from('band_members').select('band_id').in('band_id', bandIds),
  ])

  const lastActivity = new Map<string, string>()
  for (const a of (activity ?? []) as { band_id: string; created_at: string }[]) {
    if (!lastActivity.has(a.band_id)) lastActivity.set(a.band_id, a.created_at)
  }

  const memberCounts = new Map<string, number>()
  for (const m of (members ?? []) as { band_id: string }[]) {
    memberCounts.set(m.band_id, (memberCounts.get(m.band_id) ?? 0) + 1)
  }

  const storage = await Promise.all(bandRows.map(b => getBandStorageBytes(b.id)))

  return bandRows.map((b, i) => ({
    id: b.id,
    name: b.name,
    lastActivityAt: lastActivity.get(b.id) ?? b.created_at,
    storageBytes: storage[i],
    memberCount: memberCounts.get(b.id) ?? 0,
    frozenAt: b.frozen_at,
    frozenReason: b.frozen_reason,
  }))
}

interface BandRow {
  id: string
  name: string
  created_at: string
  frozen_at: string | null
  frozen_reason: string | null
}

/** Select bands including the freeze columns, degrading when they are absent. */
async function selectBands(bandIds: string[]): Promise<BandRow[]> {
  const withFreeze = await supabase
    .from('bands')
    .select('id, name, created_at, frozen_at, frozen_reason')
    .in('id', bandIds)

  if (!withFreeze.error) return (withFreeze.data ?? []) as BandRow[]
  if (!isMissingSchema(withFreeze.error)) throw withFreeze.error

  warnUnprovisioned('bands.frozen_at', withFreeze.error)
  const { data, error } = await supabase
    .from('bands')
    .select('id, name, created_at')
    .in('id', bandIds)
  if (error) throw error
  return (data ?? []).map((b: { id: string; name: string; created_at: string }) => ({
    ...b,
    frozen_at: null,
    frozen_reason: null,
  }))
}

// ── Plan state (derived, never stored) ───────────────────────────────────────

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export function graceDeadlineFromNow(now = new Date()): string {
  return new Date(now.getTime() + GRACE_PERIOD_DAYS * MS_PER_DAY).toISOString()
}

/**
 * Resolve the account state from `profiles.plan`, `grace_until` and the actual
 * data. Nothing is stored: there is no `state` column and no cron job. The
 * answer is recomputed whenever something is requested, which is the same lazy
 * pattern the preview-mix cache uses (`lib/previewMix.ts`).
 *
 *   active   — no conflicts between the plan and the data
 *   grace    — a downgrade created conflicts and `grace_until` is in the future
 *   enforced — `grace_until` has passed and conflicts remain
 */
export async function resolvePlanState(userId: string): Promise<AccountPlanState> {
  const profile = await readPlanProfile(userId)
  if (!profile) {
    return { state: 'active', plan: DEFAULT_PLAN, graceUntil: null, graceDaysLeft: 0, keepBandIds: [] }
  }

  const { plan, graceUntil, keepBandIds } = profile
  if (!graceUntil) {
    return { state: 'active', plan, graceUntil: null, graceDaysLeft: 0, keepBandIds }
  }

  const deadline = Date.parse(graceUntil)
  const now = Date.now()

  if (Number.isNaN(deadline)) {
    return { state: 'active', plan, graceUntil: null, graceDaysLeft: 0, keepBandIds }
  }

  if (deadline > now) {
    return {
      state: 'grace',
      plan,
      graceUntil,
      graceDaysLeft: Math.max(0, Math.ceil((deadline - now) / MS_PER_DAY)),
      keepBandIds,
    }
  }

  return { state: 'enforced', plan, graceUntil, graceDaysLeft: 0, keepBandIds }
}

// ── Structured refusals ──────────────────────────────────────────────────────

export type { LimitType }

/**
 * The machine-readable refusal every enforcement point returns, so the UI can
 * say which limit, what the number is, and what would lift it — never a
 * generic error.
 *
 * `message` is a convenience, not the contract: it is generated from the same
 * `lib/planCopy.ts` the client would use, so an older client that renders
 * `message` blindly still says something useful, and a newer one can ignore it
 * and compose its own copy from the structured fields.
 */
export interface LimitReachedBody {
  error: 'limit_reached'
  limit_type: LimitType
  limit: number | null
  current: number
  /** Present for `limit_type: 'feature'`. */
  feature?: GatedFeature
  /** Present when the refusal is about a specific band. */
  band_id?: string
  message: string
}

/**
 * 403 — the codebase's status for "authenticated, but not permitted"
 * (see `BAND_LIMIT_REACHED_STATUS` and the owner-only checks in the band
 * routes). Not 402: there is no payment flow to send anyone to.
 */
export const LIMIT_REACHED_STATUS = 403

export class LimitReachedError extends Error {
  readonly body: LimitReachedBody

  constructor(body: Omit<LimitReachedBody, 'error' | 'message'>) {
    super(`limit_reached:${body.limit_type}`)
    this.name = 'LimitReachedError'
    this.body = { error: 'limit_reached', ...body, message: limitMessage(body) }
  }
}

export function isLimitReachedError(err: unknown): err is LimitReachedError {
  return err instanceof LimitReachedError
}

export function limitReachedBody(
  limitType: LimitType,
  limit: Limit,
  current: number,
  extra: { feature?: GatedFeature; bandId?: string } = {},
): LimitReachedBody {
  const descriptor = {
    limit_type: limitType,
    limit: limit ?? null,
    current,
    ...(extra.feature ? { feature: extra.feature } : {}),
    ...(extra.bandId ? { band_id: extra.bandId } : {}),
  }
  return { error: 'limit_reached', ...descriptor, message: limitMessage(descriptor) }
}

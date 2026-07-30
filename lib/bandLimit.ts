/**
 * Band ownership limit — the single server-side implementation.
 *
 * THE RULE: a user may own at most `profiles.band_limit` bands. The default is
 * 3, but users who already owned more at migration time carry a higher
 * personal limit, which is exactly why the number lives in a per-user column.
 * **Never substitute a literal here.** If the limit cannot be read, this module
 * fails closed rather than assuming a default — silently demoting a
 * grandfathered user to 3 would be worse than a temporary error.
 *
 * Ownership in this schema is `band_members.role = 'owner'`, not a column on
 * `bands` (see `requireBandMember` and every other role check in the app).
 * Bands the user merely joined are members rows with a different role and cost
 * them nothing.
 *
 * Every path that can create a band must go through `createBandForUser`:
 *   - POST /api/bands            (dashboard + onboarding "create a space")
 *   - POST /api/projects         (implicit band when no band_id is supplied)
 * Defence in depth lives in the database — see
 * `supabase/migrations/20260730_band_limit_enforcement.sql`.
 */

import { supabase } from '@/lib/supabase'

/** SQLSTATE raised by the DB trigger / RPC when the limit would be exceeded. */
const PG_BAND_LIMIT_REACHED = 'BL001'
/** SQLSTATE raised when the acting user has no profiles row to read a limit from. */
const PG_BAND_LIMIT_UNKNOWN = 'BL002'
/** PostgREST: the RPC does not exist (migration not applied yet). */
const PGRST_NO_SUCH_FUNCTION = 'PGRST202'

export interface BandLimitStatus {
  /** The acting user's personal allowance, read from profiles.band_limit. */
  limit: number
  /** Bands the user currently owns. */
  current: number
  /** True when creating another band would exceed the allowance. */
  atLimit: boolean
}

/** Thrown when a create attempt is refused because the user is at their limit. */
export class BandLimitReachedError extends Error {
  readonly limit: number
  readonly current: number

  constructor(limit: number, current: number) {
    super('band_limit_reached')
    this.name = 'BandLimitReachedError'
    this.limit = limit
    this.current = current
  }
}

interface PgError {
  code?: string
  message?: string
  details?: string | null
}

function asPgError(err: unknown): PgError | null {
  if (!err || typeof err !== 'object') return null
  return err as PgError
}

/** Pull `limit=<n> current=<n>` out of the DETAIL the SQL routines attach. */
function parseLimitDetail(detail: string | null | undefined): { limit: number; current: number } | null {
  if (!detail) return null
  const limit = /limit=(\d+)/.exec(detail)
  const current = /current=(\d+)/.exec(detail)
  if (!limit || !current) return null
  return { limit: Number(limit[1]), current: Number(current[1]) }
}

function isBandLimitError(err: unknown): boolean {
  const pg = asPgError(err)
  return pg?.code === PG_BAND_LIMIT_REACHED || pg?.message === 'band_limit_reached'
}

/**
 * Read the acting user's allowance and their current owned-band count.
 * Both values come from the database; nothing here trusts the request.
 * Throws when the allowance cannot be determined (fail closed).
 */
export async function getBandLimitStatus(userId: string): Promise<BandLimitStatus> {
  const [profileRes, countRes] = await Promise.all([
    supabase.from('profiles').select('band_limit').eq('id', userId).maybeSingle(),
    supabase
      .from('band_members')
      .select('band_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'owner'),
  ])

  if (profileRes.error) throw profileRes.error
  if (countRes.error) throw countRes.error

  const limit = profileRes.data?.band_limit
  if (typeof limit !== 'number') {
    // No profile row, or the column is missing. Refuse rather than guess.
    throw new Error('band_limit_unknown')
  }

  const current = countRes.count ?? 0
  return { limit, current, atLimit: current >= limit }
}

export interface CreatedBand {
  id: string
  name: string
  [key: string]: unknown
}

/**
 * Create a band owned by `userId`, enforcing the limit atomically.
 *
 * Preferred path: the `create_band_with_owner` RPC, which does the locked
 * count check and both inserts inside one transaction, so two concurrent
 * requests cannot both pass the check.
 *
 * Fallback path: used only while the migration has not been applied yet
 * (migrations are run manually — see AGENTS.md §5). It keeps the limit
 * enforced without a transaction by re-verifying after the ownership row is
 * written and deleting the band if the check was lost to a race. Delete this
 * branch once the SQL has been run everywhere.
 *
 * @throws {BandLimitReachedError} when the user is already at their limit.
 */
export async function createBandForUser(userId: string, name: string): Promise<CreatedBand> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('name is required')

  const { data, error } = await supabase.rpc('create_band_with_owner', {
    p_user_id: userId,
    p_name: trimmed,
  })

  if (!error) {
    const band = Array.isArray(data) ? data[0] : data
    if (!band) throw new Error('Band creation returned no row')
    return band as CreatedBand
  }

  if (isBandLimitError(error)) {
    const parsed = parseLimitDetail(asPgError(error)?.details)
    const status = parsed ?? (await getBandLimitStatus(userId))
    throw new BandLimitReachedError(status.limit, status.current)
  }

  if (asPgError(error)?.code !== PGRST_NO_SUCH_FUNCTION) throw error

  return createBandForUserWithoutTransaction(userId, trimmed)
}

/**
 * Pre-migration fallback. Not a bypass: the limit is still read from the DB and
 * still checked server-side, and the post-insert re-verification closes the
 * window where two concurrent requests could both pass the initial check.
 */
async function createBandForUserWithoutTransaction(
  userId: string,
  trimmedName: string,
): Promise<CreatedBand> {
  const before = await getBandLimitStatus(userId)
  if (before.atLimit) throw new BandLimitReachedError(before.limit, before.current)

  const { data: band, error: bandErr } = await supabase
    .from('bands')
    .insert({ name: trimmedName })
    .select()
    .single()
  if (bandErr) throw bandErr

  const { error: memberErr } = await supabase
    .from('band_members')
    .insert({ band_id: band.id, user_id: userId, role: 'owner' })

  if (memberErr) {
    // Includes the DB trigger firing, if that half of the migration did run.
    await supabase.from('bands').delete().eq('id', band.id)
    if (isBandLimitError(memberErr)) {
      const parsed = parseLimitDetail(asPgError(memberErr)?.details)
      const status = parsed ?? before
      throw new BandLimitReachedError(status.limit, status.current)
    }
    throw memberErr
  }

  // Re-verify: another request may have inserted its own owner row between our
  // check and our insert. The loser of that race undoes itself.
  const after = await getBandLimitStatus(userId)
  if (after.current > after.limit) {
    await supabase.from('band_members').delete().eq('band_id', band.id).eq('user_id', userId)
    await supabase.from('bands').delete().eq('id', band.id)
    throw new BandLimitReachedError(after.limit, after.limit)
  }

  return band as CreatedBand
}

/**
 * The structured, machine-readable body the client renders its message from.
 * 403 matches how this codebase reports "you're allowed to be here, but not
 * allowed to do this" (e.g. "Only owners can rename a band").
 */
export function bandLimitReachedBody(err: BandLimitReachedError) {
  return { error: 'band_limit_reached' as const, limit: err.limit, current: err.current }
}

export const BAND_LIMIT_REACHED_STATUS = 403

/** True for the "no profiles row / column unreadable" fail-closed case. */
export function isBandLimitUnknown(err: unknown): boolean {
  const pg = asPgError(err)
  return (
    pg?.code === PG_BAND_LIMIT_UNKNOWN ||
    pg?.message === 'band_limit_unknown' ||
    (err instanceof Error && err.message === 'band_limit_unknown')
  )
}

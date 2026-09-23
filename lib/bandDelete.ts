/**
 * Deleting a space safely.
 *
 * A space used to be deletable by its owner while four other people were still
 * working in it, taking their tracks, comments and versions with it and asking
 * nothing. The rule now is blunt: **a space can only be deleted when the owner
 * is the last person in it.** Emptying it first is not friction for its own
 * sake — it is the step that makes the owner remove each person deliberately,
 * and each removal tells that person what happened (see the members route).
 *
 * ── The order of operations is the whole design ─────────────────────────────
 * 1. Stripe add-on items for this space, with proration.
 * 2. R2 objects.
 * 3. The rows.
 * 4. `settleAccount()`.
 *
 * Steps 1 and 2 have to precede 3 because both are reachable ONLY through rows
 * that step 3 destroys: `plan_addons.band_id` cascades, and a track's
 * `storage_path` is the only record that an R2 object exists. Once those rows
 * are gone, a subscription item billing for a deleted space and a few gigabytes
 * of orphaned audio are both invisible from inside the app, permanently.
 *
 * Their FAILURES are not symmetric, and the asymmetry is deliberate:
 *
 *   · Billing failure ABORTS. Charging someone for a space that no longer
 *     exists cannot be discovered or fixed from this side.
 *   · Storage failure does NOT abort. Leaked bytes cost money; a space that
 *     refuses to delete costs the user their afternoon. We log what leaked.
 */

import { supabase } from '@/lib/supabase'

/** Structured refusal code, so the client can tell this from a 500. */
export const BAND_NOT_EMPTY = 'band_not_empty'
export const BAND_OWNERLESS = 'band_would_be_ownerless'

/**
 * The SQLSTATEs raised by the database guards
 * (`supabase/migrations/20260923_deletion_invariants.sql`).
 *
 * They exist so this layer can tell an invariant violation from a broken query
 * and answer with the same structured refusal the application checks produce,
 * rather than a 500 that tells the user nothing. Custom five-character codes,
 * deliberately outside every class Postgres defines, so they cannot collide.
 *
 * ⚠ These fire even when the application check above them did not — a race, a
 * future code path, a hand-written query. That is the point of having both.
 */
export const SQLSTATE_BAND_NOT_EMPTY = 'BND01'
export const SQLSTATE_BAND_OWNERLESS = 'BND02'

export function sqlStateOf(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

export interface BandNotEmptyBody {
  error: typeof BAND_NOT_EMPTY
  /** People in the space besides the owner. Always ≥ 1 when this is returned. */
  others: number
  message: string
}

/**
 * The one wording of this refusal.
 *
 * It names the number because "remove the other members" reads as a chore of
 * unknown size, and "remove the other 4 members" reads as four clicks.
 */
export function bandNotEmptyMessage(others: number): string {
  return (
    `This space still has ${others} other ${others === 1 ? 'member' : 'members'}. ` +
    `Remove ${others === 1 ? 'them' : 'them all'} first, then delete the space — ` +
    `deleting it would take their tracks, comments and versions with it.`
  )
}

export function bandNotEmptyBody(others: number): BandNotEmptyBody {
  return { error: BAND_NOT_EMPTY, others, message: bandNotEmptyMessage(others) }
}

/** Recognise the refusal on the client, by shape rather than by status. */
export function parseBandNotEmpty(data: unknown): BandNotEmptyBody | null {
  if (!data || typeof data !== 'object') return null
  const body = data as { error?: unknown; others?: unknown; message?: unknown }
  if (body.error !== BAND_NOT_EMPTY) return null
  const others = typeof body.others === 'number' ? body.others : 1
  return {
    error: BAND_NOT_EMPTY,
    others,
    message: typeof body.message === 'string' ? body.message : bandNotEmptyMessage(others),
  }
}

// ── Account deletion ─────────────────────────────────────────────────────────

export const ACCOUNT_OWNS_BANDS = 'account_owns_spaces'

export interface OwnedSpace {
  id: string
  name: string
}

export interface AccountOwnsBandsBody {
  error: typeof ACCOUNT_OWNS_BANDS
  spaces: OwnedSpace[]
  message: string
}

/**
 * Why this refuses instead of cleaning up.
 *
 * The old route deleted every solely-owned space as a side effect of deleting
 * the account: one confirmation dialog, and every collaborator in every one of
 * those spaces lost everything, silently. The chain replacing it — delete the
 * account, so delete each space, so empty each space, so remove each person,
 * so each person is told — is longer on purpose. Destroying other people's work
 * should cost visible steps.
 */
export function accountOwnsBandsMessage(spaces: OwnedSpace[]): string {
  const names = spaces.map(s => s.name).join(', ')
  return (
    `You still own ${spaces.length} ${spaces.length === 1 ? 'space' : 'spaces'}: ${names}. ` +
    `Delete ${spaces.length === 1 ? 'it' : 'each of them'} first — and a space can only be ` +
    `deleted once you are the last member left in it, so anyone still working there gets ` +
    `removed, and told, before anything is destroyed.`
  )
}

export function accountOwnsBandsBody(spaces: OwnedSpace[]): AccountOwnsBandsBody {
  return { error: ACCOUNT_OWNS_BANDS, spaces, message: accountOwnsBandsMessage(spaces) }
}

/** Spaces this user owns, newest first. Empty means the account may be deleted. */
export async function listOwnedBandsForDeletion(userId: string): Promise<OwnedSpace[]> {
  const { data, error } = await supabase
    .from('band_members')
    .select('band_id, bands(id, name)')
    .eq('user_id', userId)
    .eq('role', 'owner')

  if (error) throw error

  // PostgREST types an embedded relation as an array even when the FK makes it
  // at most one row, and returns it either way depending on the client version.
  // Normalise instead of trusting one shape.
  return (data ?? []).map(row => {
    const r = row as { band_id: string; bands?: unknown }
    const embedded = Array.isArray(r.bands) ? r.bands[0] : r.bands
    const band = (embedded ?? null) as { id?: string; name?: string } | null
    return { id: band?.id ?? r.band_id, name: band?.name ?? 'Untitled space' }
  })
}

/** How many people are in the space who are not this user. */
export async function countOtherBandMembers(bandId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('band_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('band_id', bandId)
    .neq('user_id', userId)

  if (error) throw error
  return count ?? 0
}

export interface PurgeResult {
  /** Objects confirmed gone from R2. */
  deleted: number
  /** Objects we tried and failed to delete — leaked, and named in the log. */
  orphaned: number
  /** Objects left alone because something outside this space still points at them. */
  shared: number
}

/**
 * Delete every R2 object that belongs to this space and to nothing else.
 *
 * The reference walk is the one from `DELETE /api/projects/[id]`, generalised
 * from one project to a whole space, plus the preview mix that walk never
 * covered.
 *
 * ── Two deliberate changes to that walk ─────────────────────────────────────
 *
 * 1. The "is anything else using this hash" check is scoped to the WHOLE space,
 *    not to one project. Run per project against a per-project scope and two
 *    projects in the same space that share a file would each see the other
 *    still referencing it — the rows are not deleted until step 3 — so neither
 *    pass would delete it and the object would leak every time.
 *
 * 2. It compares version ids in memory instead of sending
 *    `.not('version_id', 'in', '(…)')`. A space can hold hundreds of versions,
 *    and that filter puts every id into the URL; the original was safe only
 *    because one project is small. Each hash has a handful of rows, so reading
 *    them and checking against a Set is both smaller and unbounded-safe.
 *
 * Never throws. A caller that let this abort a delete would be trading a
 * recoverable cost problem for an unrecoverable user problem.
 */
export async function purgeBandStorage(bandId: string): Promise<PurgeResult> {
  const result: PurgeResult = { deleted: 0, orphaned: 0, shared: 0 }

  try {
    const { deleteFromR2 } = await import('@/lib/r2')

    const { data: projects } = await supabase
      .from('projects')
      .select('id, preview_mix_storage_path')
      .eq('band_id', bandId)

    if (!projects?.length) return result

    const projectIds = projects.map((p: { id: string }) => p.id)

    // Every version in the space. This is the scope being deleted, and the set
    // a reference has to fall outside of to count as "somebody else still
    // needs this".
    const { data: versions } = await supabase
      .from('versions')
      .select('id')
      .in('project_id', projectIds)

    const scope = new Set((versions ?? []).map((v: { id: string }) => String(v.id)))

    const remove = async (key: string | null | undefined, what: string) => {
      if (!key) return
      try {
        await deleteFromR2(key)
        result.deleted++
      } catch (err) {
        result.orphaned++
        console.error(`[bands/delete] orphaned ${what} in R2: ${key}`, err)
      }
    }

    if (scope.size > 0) {
      const { data: tracks } = await supabase
        .from('tracks')
        .select('file_hash, storage_path')
        .in('version_id', [...scope])

      const seen = new Set<string>()
      for (const t of tracks ?? []) {
        if (!t.file_hash || !t.storage_path || seen.has(t.file_hash)) continue
        seen.add(t.file_hash)

        // Deduplication is by hash across a project (AGENTS.md §7), so the same
        // bytes can be referenced from several rows. Only the last reference
        // may delete the object.
        const { data: refs } = await supabase
          .from('tracks')
          .select('version_id')
          .eq('file_hash', t.file_hash)

        const usedElsewhere = (refs ?? []).some(
          (r: { version_id: string }) => !scope.has(String(r.version_id)),
        )
        if (usedElsewhere) {
          result.shared++
          continue
        }

        await remove(t.storage_path, 'track')
      }
    }

    // The preview mix: a rendered object per project that the project-delete
    // walk never touched, so every deleted project has been leaking one.
    for (const p of projects as { preview_mix_storage_path?: string | null }[]) {
      await remove(p.preview_mix_storage_path, 'preview mix')
    }
  } catch (err) {
    // Enumeration itself failed. Same rule: the delete goes ahead.
    console.error('[bands/delete] storage purge failed outright for', bandId, err)
  }

  return result
}

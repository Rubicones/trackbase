/**
 * Per-band storage accounting.
 *
 * **The ceiling is not a constant any more.** It comes from the band OWNER's
 * plan plus that band's `extra_storage` addons, resolved by
 * `getBandEntitlements()` — see `lib/storageQuota.ts`, which is the server-side
 * entry point every upload path should use. The functions here take the limit
 * as an argument so this module stays free of server-only imports: it is also
 * pulled into client components for the "STORAGE · 10 GB" labels, and importing
 * the service-role client would break those builds.
 *
 * Storage is strictly per band and is never pooled. A Band+ owner with five
 * bands has the full allowance in each of them, independently. There is no
 * account-wide storage total anywhere in this codebase, and there must not be.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Legacy flat ceiling, retained only as a display fallback for client code
 * that renders before the real per-band limit has been fetched, and as the
 * limit used while the plan migration has not been applied.
 * Do not use it as an enforcement value.
 */
export const BAND_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024 // 1 GB

export function bandStorageLimitBytes(): number {
  return BAND_STORAGE_LIMIT_BYTES
}

export function formatStorageLimit(bytes: number | null = BAND_STORAGE_LIMIT_BYTES): string {
  if (bytes === null) return 'Unlimited'
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024)
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function storageQuotaError(
  used: number,
  limit: number | null = BAND_STORAGE_LIMIT_BYTES,
): string {
  return `Band storage limit reached (${formatStorageLimit(limit)}). Delete tracks or files to free space, or upgrade the band owner's plan.`
}

type StorageDb = Pick<SupabaseClient, 'from'>

/** Sum deduplicated track bytes + resource file bytes for a band. */
export async function getBandStorageUsed(db: StorageDb, bandId: string): Promise<number> {
  const { data: projects } = await db
    .from('projects')
    .select('id')
    .eq('band_id', bandId)

  const projectIds = (projects ?? []).map(p => p.id)
  if (!projectIds.length) return 0

  const { data: versions } = await db
    .from('versions')
    .select('id')
    .in('project_id', projectIds)

  const versionIds = (versions ?? []).map(v => v.id)

  let usedBytes = 0
  const seenHashes = new Set<string>()

  if (versionIds.length) {
    const { data: tracks } = await db
      .from('tracks')
      .select('file_hash, file_size_bytes')
      .in('version_id', versionIds)

    for (const t of tracks ?? []) {
      if (t.file_hash && !seenHashes.has(t.file_hash)) {
        seenHashes.add(t.file_hash)
        usedBytes += t.file_size_bytes ?? 0
      }
    }
  }

  const { data: resources } = await db
    .from('project_resources')
    .select('file_size_bytes')
    .in('project_id', projectIds)
    .eq('type', 'file')

  for (const r of resources ?? []) {
    usedBytes += r.file_size_bytes ?? 0
  }

  return usedBytes
}

/**
 * @param limitBytes the band's resolved ceiling, or `null` for unlimited.
 *   Callers on the server should pass the value from `lib/storageQuota.ts`
 *   rather than computing one.
 */
export async function checkBandStorageQuota(
  db: StorageDb,
  bandId: string,
  additionalBytes: number,
  limitBytes: number | null = BAND_STORAGE_LIMIT_BYTES,
): Promise<{ ok: boolean; used: number; limit: number | null }> {
  const used = await getBandStorageUsed(db, bandId)
  if (limitBytes === null) return { ok: true, used, limit: null }
  return { ok: used + additionalBytes <= limitBytes, used, limit: limitBytes }
}

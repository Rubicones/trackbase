import type { SupabaseClient } from '@supabase/supabase-js'

/** Hard per-band storage ceiling (tracks + resource files). */
export const BAND_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024 // 1 GB

export function bandStorageLimitBytes(): number {
  return BAND_STORAGE_LIMIT_BYTES
}

export function formatStorageLimit(bytes = BAND_STORAGE_LIMIT_BYTES): string {
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024)
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function storageQuotaError(
  used: number,
  limit = BAND_STORAGE_LIMIT_BYTES,
): string {
  return `Band storage limit reached (${formatStorageLimit(limit)}). Delete tracks or files to free space.`
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

export async function checkBandStorageQuota(
  db: StorageDb,
  bandId: string,
  additionalBytes: number,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const used = await getBandStorageUsed(db, bandId)
  const limit = BAND_STORAGE_LIMIT_BYTES
  return { ok: used + additionalBytes <= limit, used, limit }
}

/**
 * Upload dedup, scoped to one band.
 *
 * ⚠ SERVER ONLY — it uses the service-role client.
 *
 * ── Why the scope is the point ──────────────────────────────────────────────
 * The upload paths deduplicate by `file_hash`: an identical file already in
 * the database is not re-encoded and not re-uploaded, the new row just points
 * at the object that is already there. The lookup used to match on the hash
 * alone, across the entire `tracks` table, and that had two consequences:
 *
 *   1. The quota hole (R2). `storageRefusal()` sits only in the branch that
 *      actually stores something, so a dedup hit skipped the check entirely.
 *      Any file already present ANYWHERE in the database could therefore be
 *      added to any band, in any quantity, with no refusal — and the rows are
 *      counted by `getBandStorageUsed()` afterwards, so the band went over its
 *      ceiling and stayed there, with every subsequent upload refused and no
 *      way back except deleting tracks.
 *
 *   2. A cross-band `storage_path`. Band A's row pointed at an object created
 *      for band B. Nothing reads that as ownership today, but the moment an R2
 *      cleanup job lands — deleting objects when the band that paid for them
 *      deletes the track — it breaks the other band's tracks.
 *
 * Scoping the match to the band closes both. The cost is that the same file
 * uploaded to two bands is stored twice, which is correct: each band pays for
 * its own storage, and storage in this app is never pooled (AGENTS.md §4).
 *
 * ── Why it is three queries ─────────────────────────────────────────────────
 * `tracks` reaches a band through `versions → projects`. There are no
 * generated DB types here and no embedded-resource joins anywhere in this
 * codebase, so this walks the same `projects → versions → tracks` path
 * `getBandStorageUsed()` walks, for the same reason.
 */

import { supabase } from '@/lib/supabase'

export interface DedupMatch {
  storage_path: string
  duration_ms: number | null
  file_size_bytes: number | null
}

/**
 * An existing track in `bandId` with this exact `fileHash`, or null.
 *
 * Null means "this band has never stored these bytes" — the caller must then
 * run its storage check and store them, even if some other band already has
 * an identical file.
 */
export async function findBandTrackByHash(
  bandId: string,
  fileHash: string,
): Promise<DedupMatch | null> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('band_id', bandId)

  const projectIds = (projects ?? []).map((p: { id: string }) => p.id)
  if (!projectIds.length) return null

  const { data: versions } = await supabase
    .from('versions')
    .select('id')
    .in('project_id', projectIds)

  const versionIds = (versions ?? []).map((v: { id: string }) => v.id)
  if (!versionIds.length) return null

  const { data } = await supabase
    .from('tracks')
    .select('storage_path, duration_ms, file_size_bytes')
    .eq('file_hash', fileHash)
    .in('version_id', versionIds)
    .limit(1)
    .maybeSingle()

  return (data as DedupMatch | null) ?? null
}

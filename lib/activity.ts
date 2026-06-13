import { supabase } from './supabase'

/**
 * Fire-and-forget band activity log entry.
 * Silently swallows errors so it never breaks the calling route.
 */
export async function logActivity({
  bandId,
  userId,
  action,
  subject,
  detail,
  projectId,
}: {
  bandId: string
  userId: string | null
  action:
    | 'merge' | 'branch' | 'comment' | 'upload' | 'export'
    | 'structure' | 'resource' | 'resource_update' | 'resource_remove' | 'meta'
  subject: string
  detail?: string | null
  projectId?: string | null
}): Promise<void> {
  try {
    await supabase.from('band_activity').insert({
      band_id: bandId,
      user_id: userId ?? null,
      action,
      subject,
      detail: detail ?? null,
      project_id: projectId ?? null,
    })
  } catch {
    // Non-fatal — table may not exist yet or RLS may block
  }
}

/** Human-readable label for a project resource row. */
export function resourceSubject(r: {
  type: string
  title?: string | null
  original_filename?: string | null
  url?: string | null
}): string {
  if (r.type === 'lyrics') return 'Lyrics'
  if (r.type === 'notes') return 'Notes'
  if (r.type === 'link') return r.title?.trim() || r.url?.trim() || 'Link'
  return r.title?.trim() || r.original_filename?.trim() || 'File'
}
export function fmtTimecode(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Format bytes as "30.2 MB" for activity detail strings. */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

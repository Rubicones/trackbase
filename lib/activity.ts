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
  action: 'merge' | 'branch' | 'comment' | 'upload' | 'export'
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

/** Format milliseconds as "1:24" for activity detail strings. */
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

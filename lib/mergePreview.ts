import type { AutoBarRange, ConflictRange } from '@/lib/sectionMerge'

export interface TrackSnapshot {
  id: string
  name: string
  display_name: string | null
  original_filename: string | null
  file_size_bytes: number | null
  created_at: string
  start_bar: number
}

/**
 * @deprecated Two-way compare — conflicts no longer exist. `conflicts` is
 * always `[]`; kept so existing consumers type-check.
 */
export interface ConflictTrack {
  trackName: string
  fileConflict: boolean
  renameConflict: boolean
  offsetConflict: boolean
  mainTrack: TrackSnapshot
  branchTrack: TrackSnapshot
  baseTrack: TrackSnapshot | null
}

export interface AutoMergeItem {
  action: 'take_from_branch' | 'add_new' | 'apply_rename' | 'apply_offset'
  trackName: string
  track: { id: string; name: string; display_name: string | null; original_filename: string | null; start_bar?: number }
  newDisplayName?: string
  newStartBar?: number
  previousStartBar?: number
  /** Guardrail: the target's copy of this track is newer than the version's. */
  targetNewer?: boolean
}

export interface CommentPreview {
  id: string
  author_username: string | null
  timecode_start_ms: number
  timecode_end_ms: number
  content: string
  track_name: string
  reply_count: number
}

export interface CommentChanges {
  added: CommentPreview[]
  deleted: CommentPreview[]
}

export interface MergePreview {
  conflicts: ConflictTrack[]
  autoMerge: AutoMergeItem[]
  branchName: string
  mainName: string
  branchVersionId: string
  mainVersionId: string
  targetVersionId: string
  targetVersionName: string
  branchCommentCount: number
  /** Always `[]` — two-way compare has no conflicts. Kept for compatibility. */
  sectionBarConflicts: ConflictRange[]
  sectionAutoFromBranch: AutoBarRange[]
  commentChanges?: CommentChanges
  /**
   * Tracks that exist in the target but not in the version being applied.
   * Target wins by default (they are kept untouched); the diff screen offers
   * an opt-in per-track removal.
   */
  targetOnlyTracks?: TrackSnapshot[]
}

export type MergeResolution = {
  fileChoice?: 'main' | 'branch'
  nameChoice?: 'main' | 'branch'
  offsetChoice?: 'main' | 'branch'
}

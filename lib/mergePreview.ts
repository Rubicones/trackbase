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
  sectionBarConflicts: ConflictRange[]
  sectionAutoFromBranch: AutoBarRange[]
  commentChanges?: CommentChanges
}

export type MergeResolution = {
  fileChoice?: 'main' | 'branch'
  nameChoice?: 'main' | 'branch'
  offsetChoice?: 'main' | 'branch'
}

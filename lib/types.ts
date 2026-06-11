export interface CommentReply {
  id: string
  comment_id: string
  content: string
  created_by: string
  author_username: string
  created_at: string
}

export interface TrackComment {
  id: string
  track_id: string
  version_id: string
  content: string
  timecode_start_ms: number
  timecode_end_ms: number
  created_by: string
  author_username: string
  created_at: string
  replies?: CommentReply[]
}

export interface Track {
  id: string
  version_id: string
  name: string
  display_name: string | null   // user-editable label; shown instead of name when set
  original_filename: string | null
  file_hash: string
  storage_path: string
  duration_ms: number | null
  file_size_bytes: number | null
  position: number
  icon_emoji: string | null     // e.g. "🎸"
  icon_color: string | null     // background hex for icon square
  comments: TrackComment[]
}

export interface Version {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  type: 'main' | 'branch'
  created_at: string
  merged_at: string | null
  tracks: Track[]
}

export interface Project {
  id: string
  band_id: string
  band_name?: string
  name: string
  bpm: number | null
  key: string | null
  time_signature: string | null  // e.g. '4/4', '3/4'; default '4/4'
}

export type SectionType =
  | 'intro' | 'verse' | 'chorus' | 'pre-chorus'
  | 'bridge' | 'drop' | 'breakdown' | 'outro' | 'custom'

export interface Section {
  id: string
  version_id: string
  project_id: string
  type: SectionType
  custom_name: string | null
  start_bar: number
  end_bar: number
  chords: string | null
  color: string
  position: number
  created_at: string
}

// Shared mixer types — extracted verbatim from page.tsx (behavior-preserving refactor).

// ── Upload state machine ──────────────────────────────────────────────────────

export type UploadStatus = 'pending' | 'presigning' | 'uploading' | 'processing' | 'done' | 'error'

export interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  progress: number    // 0-100, meaningful during 'uploading'
  error?: string
  tempKey?: string    // set once the file is fully on R2; if set on error, only processing failed
  sha256?: string     // of the uploaded bytes, sent to process for the integrity check
}

export interface ActiveCommentInput {
  trackId: string
  startMs: number
  endMs: number
  startXPercent: number
  endXPercent: number
  waveformTop: number
  waveformLeft: number
  waveformWidth: number
  waveformHeight: number
}

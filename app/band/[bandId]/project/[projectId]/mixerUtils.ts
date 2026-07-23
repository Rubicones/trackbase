// Pure helpers, formatters, and layout constants for the mixer.
// Extracted verbatim from page.tsx (behavior-preserving refactor).
import { sixteenthDuration } from '@/lib/midi'
import type { Track } from '@/lib/types'


/**
 * Upload a File directly to a presigned R2 URL via XHR.
 * Uses XHR (not fetch) because fetch doesn't expose upload progress.
 */
export function uploadToR2Direct(
  file: File,
  presignedUrl: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.ontimeout = () => reject(new Error('Upload timed out'))

    xhr.open('PUT', presignedUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.timeout = 30 * 60 * 1000 // 30 min for very large files
    xhr.send(file)
  })
}
// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtSize(b: number | null) {
  if (!b) return ''
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export const fmtMs = (ms: number) => fmtTime(ms / 1000)

export function fmtDate(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export function durationMsToBars(durationMs: number, bpm: number, timeSignature: string): number {
  const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar
  return barDurationMs > 0 ? Math.ceil((durationMs || 0) / barDurationMs) : 0
}

/** Track content length in ms on the project timeline (excludes start_bar offset). */
export function trackContentDurationMs(
  t: Track,
  projBpm: number,
  runtimeMs?: number,
): number {
  if (t.file_type === 'midi' && t.midi_data?.notes?.length) {
    const sixthMs = sixteenthDuration(projBpm) * 1000
    const lastEnd = Math.max(...t.midi_data.notes.map(n => n.startSixteenth + n.durationSixteenths))
    return Math.ceil(lastEnd * sixthMs)
  }
  return (runtimeMs && runtimeMs > 0 ? runtimeMs : t.duration_ms) ?? 0
}

/** End position on the project timeline in seconds (start_bar + content). */
export function trackTimelineEndSec(
  t: Track,
  projBpm: number,
  projTimeSig: string,
  decodedDurationSec?: number,
): number {
  const beatsPerBar = parseInt(projTimeSig.split('/')[0]) || 4
  const barDurSec = (60 / projBpm) * beatsPerBar
  const startSec = (t.start_bar ?? 0) * barDurSec
  const contentSec = trackContentDurationMs(t, projBpm, decodedDurationSec ? decodedDurationSec * 1000 : undefined) / 1000
  return startSec + contentSec
}

// ─── Track row layout ─────────────────────────────────────────────────────────

export const TRACK_LABEL_W = 192
export const TRACK_ROW_H = 96
export const COMPACT_TRACK_ROW_H = 58

/** Position a clip on the full track row — bar 0 aligns with the waveform column left edge. */
export function trackClipRowStyle(
  labelW: number,
  totalBars: number,
  startBar: number,
  widthTimelinePercent: number,
): { left: string; width: string } {
  const barFrac = totalBars > 0 ? startBar / totalBars : 0
  const widthFrac = widthTimelinePercent / 100
  return {
    left: `calc(${labelW}px + (100% - ${labelW}px) * ${barFrac})`,
    width: `calc((100% - ${labelW}px) * ${widthFrac})`,
  }
}

export function trackClipRowLeft(labelW: number, totalBars: number, startBar: number): string {
  const barFrac = totalBars > 0 ? startBar / totalBars : 0
  return `calc(${labelW}px + (100% - ${labelW}px) * ${barFrac})`
}

export function trackClipLeftPx(
  labelW: number,
  totalBars: number,
  startBar: number,
  rowWidth: number,
): number {
  const barFrac = totalBars > 0 ? startBar / totalBars : 0
  return labelW + (rowWidth - labelW) * barFrac
}

/** Hard ceiling for the project timeline (bars) — live recording auto-extends up to this. */
export const MAX_PROJECT_BARS = 1000
export const RECORDING_EXTEND_CHUNK_BARS = 16
export const RECORDING_EXTEND_LEAD_BARS = 4
// ─── Version tag helpers ──────────────────────────────────────────────────────

export interface TagStyle { label: string; bg: string; darkBg: string }

export const PREDEFINED_TAGS: Record<string, TagStyle> = {
  // violet — experimentation, unknown territory (reuses --dot-upload)
  experiment: { label: 'EXP',  bg: '#7c3aed', darkBg: '#a78bfa' },
  // red — corrective action, something to fix (reuses --danger)
  fix:         { label: 'FIX',  bg: '#dc2626', darkBg: '#f87171' },
  // cyan — structure, architecture (reuses --dot-structure)
  arrangement: { label: 'ARR',  bg: '#0891b2', darkBg: '#22d3ee' },
  // indigo — core production work, the app's own accent
  mix:         { label: 'MIX',  bg: '#6366F1', darkBg: '#818cf8' },
  // pink — additive, creative additions (reuses --dot-resource)
  feature:     { label: 'FEAT', bg: '#db2777', darkBg: '#f472b6' },
}

// Amber for custom tags — flexible, user-defined (reuses --dot-branch)
export const CUSTOM_TAG_COLORS = { bg: '#D97706', darkBg: '#F59E0B' }

/** Returns label + background color for a tag, or null if no tag. */
export function versionTagStyle(
  tag: string | null | undefined,
  dark: boolean,
): { label: string; bg: string } | null {
  if (!tag) return null
  const preset = PREDEFINED_TAGS[tag]
  if (preset) return { label: preset.label, bg: dark ? preset.darkBg : preset.bg }
  return { label: tag, bg: dark ? CUSTOM_TAG_COLORS.darkBg : CUSTOM_TAG_COLORS.bg }
}
// ─── Format bytes helper ──────────────────────────────────────────────────────

export function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

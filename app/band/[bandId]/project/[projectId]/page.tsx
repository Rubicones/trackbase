'use client'

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { TrackComment, CommentReply, Track, Version, Project, Section, MidiTrackData } from '@/lib/types'
import { useVersionCache } from '@/hooks/useVersionCache'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { allTracksLoaded } from '@/lib/transportStatus'
import { ProjectTour, TourHelpButton } from '@/components/onboarding/ProjectTour'
import { MergeModal } from './MergeModal'
import StructureOverlay, { getBarMath } from '@/components/StructureEditor'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { ResourcesCard } from '@/components/ResourcesCard'
import { AppHeader, SectionLabel, StatusFooter } from '@/components/design/AppShell'
import { ResourceErrorScreen } from '@/components/design/ResourceErrorScreen'
import { RoadmapPreview } from '@/components/RoadmapPreview'
import { SongRoadmap, useProjectRoadmap } from '@/components/SongRoadmap'
import { SongChecklist, type ChecklistItem, type ChecklistMember } from '@/components/SongChecklist'
import { Toast } from '@/components/design/Toast'
import { TactGrid } from '@/components/design/TactGrid'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { UserAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { waveformBarsCache, fetchTrackAudioBuffer, audioArrayBufferCache } from '@/lib/waveformCache'
import { WaveformBarRow, downsampleWaveformBars } from '@/components/WaveformBars'
import { MobileExperience } from '@/components/MobileExperience'
import { MobileMixerVersionBar } from '@/components/MobileMixerVersionBar'
import { getTrackIconSwatches, trackAccentColor, needsTrackIconColor, pickTrackIconColor } from '@/lib/trackIcon'
import { Skeleton } from '@/components/ui/Skeleton'
import { BAND_STORAGE_LIMIT_BYTES, formatStorageLimit, storageQuotaError } from '@/lib/bandStorage'
import { clampTrackStartBar, formatTrackStartBar } from '@/lib/trackMerge'
import { ChatDock } from '@/components/chat/ChatDock'
import { useChatPanel } from '@/components/chat/useChatPanel'
import { useResourcesSidebarOpen } from '@/lib/useResourcesSidebarOpen'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import PianoRollEditor from '@/components/PianoRollEditor'
import { gmProgramLabel, sixteenthDuration, sixteenthsPerBar, gmInstrumentName } from '@/lib/midi'
import { midiRenderSourceKey, renderMidiTrackToBuffer } from '@/lib/midiRender'
import { warmMidiSoundfontModule } from '@/lib/midiSoundfont'
import {
  METRONOME_TRACK_ID,
  PREVIEW_MIX_TRACK_ID,
  generateMetronomeBuffer,
  snapToPreviousBarSec,
  startCountdown,
} from '@/lib/metronomeAudio'
import { buildSectionRanges, findSectionRangeAtTime } from '@/lib/sectionPlayback'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { registerPlaybackStop } from '@/lib/playbackSession'
import {
  fetchPreviewMixBuffer,
  prefetchPreviewMixPlayback,
  previewMixPlaybackUrl,
  takePreloadedPreviewAudio,
} from '@/lib/previewMixClient'
import { RecordingTrackRow, type RecordingTrackControl, type RecordState } from '@/components/RecordingTrackRow'

// ─── Types ────────────────────────────────────────────────────────────────────

// ── Upload state machine ──────────────────────────────────────────────────────

type UploadStatus = 'pending' | 'presigning' | 'uploading' | 'processing' | 'done' | 'error'

interface UploadItem {
  id: string
  file: File
  status: UploadStatus
  progress: number    // 0-100, meaningful during 'uploading'
  error?: string
  tempKey?: string    // saved after presign; if set on error, only processing failed
}

interface ActiveCommentInput {
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

// ─── Audio caches ─────────────────────────────────────────────────────────────
// Imported from @/lib/waveformCache (shared with StructureEditor).

// ─── Upload helpers ───────────────────────────────────────────────────────────

const MAX_CONCURRENT_UPLOADS = 3

// Style for bottom sheet action buttons (short landscape topbar overflow)
const sheetBtnStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', padding: '11px 20px', background: 'none', border: 'none',
  textAlign: 'left', cursor: 'pointer', fontSize: 14,
  color: 'var(--text-sec)',
}


/**
 * Upload a File directly to a presigned R2 URL via XHR.
 * Uses XHR (not fetch) because fetch doesn't expose upload progress.
 */
function uploadToR2Direct(
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

function fmtSize(b: number | null) {
  if (!b) return ''
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

const fmtMs = (ms: number) => fmtTime(ms / 1000)

function fmtDate(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function durationMsToBars(durationMs: number, bpm: number, timeSignature: string): number {
  const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar
  return barDurationMs > 0 ? Math.ceil((durationMs || 0) / barDurationMs) : 0
}

/** Track content length in ms on the project timeline (excludes start_bar offset). */
function trackContentDurationMs(
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
function trackTimelineEndSec(
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

function calculateProjectTotalBars(tracks: Track[], bpm: number, timeSignature: string): number {
  if (!tracks.length) return 16
  const beatsPerBar = parseInt(timeSignature.split('/')[0]) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar
  if (!barDurationMs) return 16
  const endBars = tracks.map(t => {
    const trackBars = durationMsToBars(t.duration_ms ?? 0, bpm, timeSignature)
    return (t.start_bar ?? 0) + trackBars
  })
  return Math.max(...endBars, 16)
}

/** Compute dot y-offsets for overlapping comment ranges (8px per level). */
function computeOverlapOffsets(comments: TrackComment[]): Map<string, number> {
  const sorted = [...comments].sort((a, b) => a.timecode_start_ms - b.timecode_start_ms)
  const offsets = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    let offset = 0
    for (let j = 0; j < i; j++) {
      const prev = sorted[j]
      if (c.timecode_start_ms < prev.timecode_end_ms) {
        offset = (offsets.get(prev.id) ?? 0) + 8
      }
    }
    offsets.set(c.id, offset)
  }
  return offsets
}

type InstrumentType = 'drums' | 'bass' | 'guitar' | 'keys' | 'vocals' | 'generic'

function detectInstrument(name: string): InstrumentType {
  const n = name.toLowerCase()
  if (/drum|kick|snare|hat|perc|beat/.test(n)) return 'drums'
  if (/bass/.test(n)) return 'bass'
  if (/guitar|gtr/.test(n)) return 'guitar'
  if (/key|piano|synth|organ|pad/.test(n)) return 'keys'
  if (/vocal|vox|voice|lead/.test(n)) return 'vocals'
  return 'generic'
}

// ─── Instrument SVG icons ─────────────────────────────────────────────────────

function InstrumentSVG({ type, color }: { type: InstrumentType; color: string }) {
  const c = color
  switch (type) {
    case 'drums':
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <ellipse cx="7.5" cy="10" rx="5" ry="2.5" stroke={c} strokeWidth="0.9" />
          <ellipse cx="7.5" cy="7" rx="5" ry="2.5" stroke={c} strokeWidth="0.9" />
          <line x1="2.5" y1="7" x2="2.5" y2="10" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="12.5" y1="7" x2="12.5" y2="10" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
          <path d="M5 4L7 6M10 4L8 6" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
    case 'bass':
    case 'guitar':
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M5 2h5l.5.5v2H4.5V2.5L5 2z" stroke={c} strokeWidth="0.9" strokeLinejoin="round" />
          <rect x="4.5" y="4" width="6" height="1" fill={c} />
          <path d="M5.5 5v3.5a2 2 0 0 0 4 0V5" stroke={c} strokeWidth="0.9" />
          <circle cx="7.5" cy="9" r="2" stroke={c} strokeWidth="0.8" />
        </svg>
      )
    case 'keys':
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <rect x="1.5" y="5" width="12" height="7" rx="1" stroke={c} strokeWidth="0.9" />
          <line x1="4.5" y1="5" x2="4.5" y2="10" stroke={c} strokeWidth="0.8" />
          <line x1="7.5" y1="5" x2="7.5" y2="10" stroke={c} strokeWidth="0.8" />
          <line x1="10.5" y1="5" x2="10.5" y2="10" stroke={c} strokeWidth="0.8" />
          <rect x="3" y="5" width="2" height="3.5" rx="0.3" fill={c} opacity="0.6" />
          <rect x="6" y="5" width="2" height="3.5" rx="0.3" fill={c} opacity="0.6" />
          <rect x="9" y="5" width="2" height="3.5" rx="0.3" fill={c} opacity="0.6" />
        </svg>
      )
    case 'vocals':
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <rect x="5.5" y="2" width="4" height="6" rx="2" stroke={c} strokeWidth="0.9" />
          <path d="M3 8.5a4.5 4.5 0 0 0 9 0" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="7.5" y1="13" x2="7.5" y2="12" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
          <line x1="6" y1="13" x2="9" y2="13" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
    default:
      return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M6 12V5.5l6-1.5v6" stroke={c} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="4.5" cy="12" r="1.5" stroke={c} strokeWidth="0.9" />
          <circle cx="10.5" cy="10.5" r="1.5" stroke={c} strokeWidth="0.9" />
          <path d="M9 7V5" stroke={c} strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
  }
}

// ─── Uikit buttons ────────────────────────────────────────────────────────────

function TbBtn({
  children,
  variant = 'ghost',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'solid'
}) {
  const base = 'text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5'
  const styles = {
    ghost: 'border border-border text-muted-foreground hover:border-lime hover:text-lime px-3 py-1.5',
    primary: 'bg-lime text-primary-foreground border border-lime px-3 py-1.5 font-display font-bold',
    solid: 'bg-foreground text-background px-3 py-1.5 font-bold hover:bg-lime',
  }
  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="btn-icon" style={{ visibility: 'hidden' }} />

  const isDark = resolvedTheme === 'dark'

  function toggle() {
    document.documentElement.classList.add('theme-transition')
    setTheme(isDark ? 'light' : 'dark')
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300)
  }

  return (
    <button onClick={toggle} className="btn-icon" title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <span key={resolvedTheme} style={{ display: 'flex', animation: 'theme-icon-in 0.2s ease forwards' }}>
        {isDark ? (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1" />
            <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.9 2.9l1.06 1.06M11.04 11.04l1.06 1.06M2.9 12.1l1.06-1.06M11.04 3.96l1.06-1.06"
              stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M12.5 9A6 6 0 0 1 6 2.5a6 6 0 1 0 6.5 6.5z"
              stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  )
}

// ─── Comment tooltip (portal) ─────────────────────────────────────────────────

function isCommentUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-comment-ui]') !== null
}

function CommentTooltip({
  comment, anchorLeft, anchorTop, onDelete, onHide, onShow, currentUserId, isOwner, onReplySubmit, onReplyFocusChange,
}: {
  comment: TrackComment
  anchorLeft: number
  anchorTop: number
  onDelete: (id: string) => void
  onHide: () => void
  onShow?: () => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplySubmit: (commentId: string, content: string) => Promise<void>
  onReplyFocusChange?: (focused: boolean) => void
}) {
  const W = 260
  let left = anchorLeft - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  const [showAllReplies, setShowAllReplies] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const replies: CommentReply[] = (comment.replies ?? []) as CommentReply[]
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2)
  const hiddenCount = replies.length - 2

  const canDelete = comment.created_by === currentUserId || isOwner
  const author = comment.author_username ?? 'unknown'

  return (
    <FloatingPopover left={left} top={anchorTop} width={W} onMouseLeave={onHide} onMouseEnter={onShow}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <UserAvatar seed={author} size={18} kind="user" />
          <span className="text-[11px] text-foreground truncate">{author}</span>
          <span className="text-[10px] tabular-nums text-lime shrink-0">
            {fmtMs(comment.timecode_start_ms)} → {fmtMs(comment.timecode_end_ms)}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(comment.id) }}
              className="ml-auto text-muted-foreground hover:text-destructive transition-colors grid place-items-center size-6 shrink-0"
              aria-label="Delete comment"
            >
              <TrashIcon />
            </button>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground m-0 mb-2">{relativeTime(comment.created_at)}</p>
        <p className="text-[13px] text-foreground leading-snug break-words m-0">{comment.content}</p>

        {replies.length > 0 && (
          <div className="border-t border-border mt-2 pt-2 space-y-2">
            {visibleReplies.map(r => (
              <div key={r.id}>
                <div className="flex items-center gap-2 mb-0.5">
                  <UserAvatar seed={r.author_username} size={16} kind="user" />
                  <span className="text-[11px] text-foreground">{r.author_username}</span>
                </div>
                <p className="text-[12px] text-foreground/85 leading-snug m-0">{r.content}</p>
                <p className="text-[9px] text-muted-foreground m-0 mt-0.5">{relativeTime(r.created_at)}</p>
              </div>
            ))}
            {!showAllReplies && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllReplies(true)}
                className="text-[10px] uppercase tracking-widest text-lime hover:underline"
              >
                Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        )}

        <div className={`border-t border-border pt-2 ${replies.length > 0 ? 'mt-2' : 'mt-3'}`}>
          <input
            placeholder="Reply..."
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onPointerDown={e => {
              e.stopPropagation()
              onReplyFocusChange?.(true)
            }}
            onFocus={() => onReplyFocusChange?.(true)}
            onBlur={() => { setTimeout(() => onReplyFocusChange?.(false), 150) }}
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            onKeyDown={async e => {
              if (e.key === 'Enter' && !e.shiftKey && replyText.trim() && !submittingReply) {
                e.preventDefault()
                setSubmittingReply(true)
                try { await onReplySubmit(comment.id, replyText.trim()); setReplyText('') }
                catch { /* ignore */ }
                finally { setSubmittingReply(false) }
              }
            }}
            className="flex h-8 w-full font-display border border-border bg-transparent px-3 py-1 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
    </FloatingPopover>
  )
}

// ─── Comment toggle (icon button for mobile top bar) ─────────────────────────

function CommentToggleBtn({
  active, count, onClick, className = 'size-8',
}: {
  active: boolean
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour="comments-toggle"
      aria-label={active ? 'Exit comment mode' : `Comments${count > 0 ? ` (${count})` : ''}`}
      aria-pressed={active}
      className={`${className} border grid place-items-center transition shrink-0 relative ${
        active
          ? 'border-lime bg-lime text-primary-foreground'
          : 'border-border bg-surface-2 text-muted-foreground hover:border-lime hover:text-lime'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2.5 3.5h11a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H9.2L7 13.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      {!active && count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-lime text-primary-foreground text-[8px] font-bold leading-[14px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}


function CommentRangeMarker({ comment, durationMs, dotTopOffset, commentMode, onDelete, currentUserId, isOwner, onReplyCreate, onInteractionChange }: {
  comment: TrackComment
  durationMs: number
  dotTopOffset: number
  commentMode: boolean
  onDelete: (id: string) => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  onInteractionChange?: (commentId: string, active: boolean) => void
}) {
  const startPct = durationMs > 0 ? (comment.timecode_start_ms / durationMs) * 100 : 0
  const endPct = durationMs > 0 ? (comment.timecode_end_ms / durationMs) * 100 : 0
  const widthPct = Math.max(endPct - startPct, 0)
  const isNarrow = widthPct < 3

  const [showTooltip, setShowTooltip] = useState(false)
  const [replyFocused, setReplyFocused] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tooltipVisible = showTooltip || replyFocused

  useEffect(() => {
    onInteractionChange?.(comment.id, tooltipVisible)
    return () => onInteractionChange?.(comment.id, false)
  }, [tooltipVisible, comment.id, onInteractionChange])

  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => {
      if (!replyFocused) setShowTooltip(false)
    }, 120)
  }
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  function getAnchor() {
    const r = rangeRef.current?.getBoundingClientRect()
    if (!r) return { left: 0, top: 0 }
    return isNarrow
      ? { left: r.left, top: r.top }
      : { left: r.left + r.width / 2, top: r.top }
  }

  const replyCount = comment.replies?.length ?? 0

  // Tap outside to close on touch devices
  useEffect(() => {
    if (!showTooltip || commentMode) return
    function onDoc(e: PointerEvent) {
      const t = e.target as Node
      if (rangeRef.current?.contains(t)) return
      if (isCommentUiTarget(e.target)) return
      setShowTooltip(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [showTooltip, commentMode])

  function handleMarkerTap(e: React.MouseEvent) {
    if (commentMode) return
    // Desktop uses hover; touch devices toggle on tap
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) return
    e.stopPropagation()
    setShowTooltip(v => !v)
  }

  return (
    <div
      ref={rangeRef}
      className="absolute top-0 h-full z-[3]"
      data-comment-ui
      style={{
        left: `${startPct}%`,
        width: `${widthPct}%`,
        pointerEvents: commentMode ? 'none' : 'auto',
        minWidth: isNarrow ? 20 : 2,
      }}
      onMouseEnter={() => { if (!commentMode) { cancelHide(); setShowTooltip(true) } }}
      onMouseLeave={scheduleHide}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onClick={handleMarkerTap}
    >
      {/* Range fill */}
      <div
        className="absolute inset-0 transition-colors duration-150 waveform-accent-fill"
        style={{ opacity: tooltipVisible ? 1 : 0.55 }}
      />
      {/* Left edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 waveform-accent-edge"
        style={{ left: 0, width: 1.5, opacity: tooltipVisible ? 1.0 : 0.5 }}
      />
      {/* Right edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 waveform-accent-edge"
        style={{ right: 0, width: 1.5, opacity: tooltipVisible ? 1.0 : 0.5 }}
      />
      {tooltipVisible && (() => {
        const { left, top } = getAnchor()
        return (
          <CommentTooltip
            comment={comment}
            anchorLeft={left}
            anchorTop={top}
            onDelete={onDelete}
            onHide={scheduleHide}
            onShow={cancelHide}
            currentUserId={currentUserId}
            isOwner={isOwner}
            onReplySubmit={onReplyCreate}
            onReplyFocusChange={(focused) => setReplyFocused(focused)}
          />
        )
      })()}
    </div>
  )
}

// ─── Comment input bubble (portal) ────────────────────────────────────────────

function CommentInputBubble({ input, onSubmit, onClose, currentUser }: {
  input: ActiveCommentInput
  onSubmit: (content: string) => Promise<void>
  onClose: () => void
  currentUser: { username: string } | null
}) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errored, setErrored] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 20) }, [])
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = ('touches' in e ? document.elementFromPoint(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0) : e.target) as Node | null
      if (bubbleRef.current && t && !bubbleRef.current.contains(t)) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose])

  async function submit() {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try { await onSubmit(text.trim()); onClose() }
    catch { setErrored(true); setTimeout(() => setErrored(false), 1000) }
    finally { setSubmitting(false) }
  }

  const W = 248
  const { waveformLeft, waveformWidth, waveformTop, startXPercent, endXPercent, startMs, endMs } = input
  const centerPct = (startXPercent + endXPercent) / 2
  const lineX = waveformLeft + centerPct * waveformWidth

  // Center bubble over range, clamp to viewport
  let left = lineX - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  return (
    <FloatingPopover left={left} top={waveformTop - 8} width={W}>
      <div ref={bubbleRef} className="p-3">
        {currentUser && (
          <div className="flex items-center gap-2 mb-2">
            <UserAvatar seed={currentUser.username} size={16} kind="user" />
            <span className="text-[11px] text-foreground">{currentUser.username}</span>
          </div>
        )}
        <div className="text-[10px] tabular-nums text-lime mb-2">
          {fmtMs(startMs)} → {fmtMs(endMs)}
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="Add comment..."
          className="flex h-8 w-full font-display border border-border bg-transparent px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-border">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">esc to cancel</span>
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting || !text.trim()}
            className="uppercase tracking-widest text-[10px] font-bold h-7"
          >
            {submitting ? '…' : errored ? 'Error' : 'Send'}
          </Button>
        </div>
      </div>
    </FloatingPopover>
  )
}

// ─── Track row layout ─────────────────────────────────────────────────────────

const TRACK_LABEL_W = 192
const TRACK_ROW_H = 80
const COMPACT_TRACK_ROW_H = 48

/** Position a clip on the full track row — bar 0 aligns with the waveform column left edge. */
function trackClipRowStyle(
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

function trackClipRowLeft(labelW: number, totalBars: number, startBar: number): string {
  const barFrac = totalBars > 0 ? startBar / totalBars : 0
  return `calc(${labelW}px + (100% - ${labelW}px) * ${barFrac})`
}

function trackClipLeftPx(
  labelW: number,
  totalBars: number,
  startBar: number,
  rowWidth: number,
): number {
  const barFrac = totalBars > 0 ? startBar / totalBars : 0
  return labelW + (rowWidth - labelW) * barFrac
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({
  trackId, color, durationMs,
  commentMode, comments, activeInput, audioReady,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput, onReady,
  currentUserId, isOwner, onReplyCreate, currentUser, onCommentInteractionChange,
  compact = false, barCount = 96, interactionsEnabled = true,
}: {
  trackId: string; color: string; durationMs: number
  commentMode: boolean; comments: TrackComment[]; activeInput: ActiveCommentInput | null; audioReady: boolean
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onReady?: (decodedDurationMs?: number) => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUser: { username: string } | null
  onCommentInteractionChange?: (commentId: string, active: boolean) => void
  compact?: boolean
  /** How many bars to render. Scale this proportionally to the clip's share of the timeline
   *  so each bar stays ~12 px wide regardless of clip length. Defaults to 96. */
  barCount?: number
  interactionsEnabled?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<number[]>([])
  const [ready, setReady] = useState(false)

  // Drag state — ref to avoid re-renders during drag
  const dragRef = useRef<{
    active: boolean
    startPct: number
    currentPct: number
  } | null>(null)
  // Visual drag rect state — drives re-render of selection overlay
  const [dragRect, setDragRect] = useState<{ startX: number; endX: number } | null>(null)

  // Stable ref for finalize so window listener always calls fresh version
  const finalizeDragFnRef = useRef<() => void>(() => {})
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Fast path: bars already in session cache (e.g. seeded right after recording).
      const cachedBars = waveformBarsCache.get(trackId)
      if (cachedBars) {
        barsRef.current = cachedBars
        setReady(true)
        onReadyRef.current?.()
        return
      }
      try {
        const actx = new AudioContext()
        const ab = await fetchTrackAudioBuffer(trackId)
        if (!ab || cancelled) return
        const decoded = await actx.decodeAudioData(ab)
        const raw = decoded.getChannelData(0)
        const N = 96
        const block = Math.floor(raw.length / N)
        const amps: number[] = []
        for (let i = 0; i < N; i++) {
          let s = 0
          for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j])
          amps.push(s / block)
        }
        const max = Math.max(...amps, 0.001)
        if (!cancelled) {
          const bars = amps.map(a => a / max)
          waveformBarsCache.set(trackId, bars)
          barsRef.current = bars
          setReady(true)
          onReadyRef.current?.(Math.round(decoded.duration * 1000))
        }
        actx.close()
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [trackId])

  function getXPercent(clientX: number): number {
    const rect = containerRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  // Keep finalizeRange fresh so the window listener always captures current durationMs / onCommentPlace
  const finalizeRange = useCallback(() => {
    const dr = dragRef.current
    if (!dr?.active) return
    dr.active = false
    setDragRect(null)
    dragRef.current = null

    const { startPct, currentPct } = dr
    if (Math.abs(currentPct - startPct) < 0.01) return
    // Guard: if the player hasn't decoded audio yet, durationMs is 0 and we'd
    // produce startMs === endMs === 0 which the API rejects.
    if (durationMs <= 0) return

    const minPct = Math.min(startPct, currentPct)
    const maxPct = Math.max(startPct, currentPct)
    // Ensure at least 1ms gap after rounding so end > start is always satisfied
    const startMs = Math.round(minPct * durationMs)
    const endMs = Math.max(startMs + 1, Math.round(maxPct * durationMs))
    const rect = containerRef.current!.getBoundingClientRect()
    onCommentPlace({
      trackId,
      startMs,
      endMs,
      startXPercent: minPct,
      endXPercent: maxPct,
      waveformTop: rect.top,
      waveformLeft: rect.left,
      waveformWidth: rect.width,
      waveformHeight: rect.height,
    })
  }, [durationMs, onCommentPlace, trackId])

  // Update the ref each render so the window listener uses the latest closure
  finalizeDragFnRef.current = finalizeRange

  // Attach window-level mouseup/touchend so releasing outside waveform still finalizes
  useEffect(() => {
    const handler = () => finalizeDragFnRef.current()
    window.addEventListener('mouseup', handler)
    window.addEventListener('touchend', handler)
    return () => {
      window.removeEventListener('mouseup', handler)
      window.removeEventListener('touchend', handler)
    }
  }, [])

  function handleDragStart(clientX: number) {
    if (!interactionsEnabled || !commentMode) return
    const pct = getXPercent(clientX)
    dragRef.current = { active: true, startPct: pct, currentPct: pct }
    setDragRect({ startX: pct, endX: pct })
  }

  function handleDragMove(clientX: number) {
    if (!commentMode || !dragRef.current?.active) return
    const pct = Math.max(0, Math.min(1, getXPercent(clientX)))
    dragRef.current.currentPct = pct
    setDragRect({ startX: dragRef.current.startPct, endX: pct })
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    handleDragStart(e.clientX)
  }

  function handleMouseMove(e: React.MouseEvent) {
    handleDragMove(e.clientX)
  }

  function handleTouchStart(e: React.TouchEvent) {
    e.preventDefault()
    handleDragStart(e.touches[0].clientX)
  }

  function handleTouchMove(e: React.TouchEvent) {
    e.preventDefault()
    handleDragMove(e.touches[0].clientX)
  }

  const overlapOffsets = computeOverlapOffsets(comments)
  const thisInputActive = activeInput?.trackId === trackId

  const cursor = commentMode
    ? (dragRect !== null ? 'ew-resize' : 'crosshair')
    : 'default'

  const dragSpan = dragRect ? Math.abs(dragRect.endX - dragRect.startX) : 0

  const displayCount = Math.max(4, barCount)
  const bars = ready
    ? downsampleWaveformBars(barsRef.current, displayCount)
    : Array.from({ length: displayCount }, () => 0.15)

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-visible px-1 py-2${interactionsEnabled ? '' : ' pointer-events-none'}`}
      style={{ cursor: interactionsEnabled ? cursor : 'default', userSelect: 'none', WebkitUserSelect: 'none', touchAction: commentMode ? 'none' : 'auto' } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      onMouseMove={commentMode ? handleMouseMove : undefined}
      onTouchStart={commentMode ? handleTouchStart : undefined}
      onTouchMove={commentMode ? handleTouchMove : undefined}
    >
      <div className="absolute inset-x-1 top-2 bottom-2 z-[1]">
        <WaveformBarRow
          bars={bars}
          color={color}
          progress={ready ? 1 : 0}
          className="h-full"
          animate={ready}
        />
      </div>

      {commentMode && !dragRect && (
        <div className="absolute inset-0 z-[2] pointer-events-none bg-lime/5 border border-dashed border-lime/40 grid place-items-center">
          <div className={`uppercase tracking-widest text-lime bg-background/90 border border-lime/40 ${
            compact ? 'text-[8px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1'
          }`}>
            {compact ? 'Tap & drag' : 'Click-drag to comment'}
          </div>
        </div>
      )}

      {/* Saved comment ranges (only after audio is decoded) */}
      {audioReady && comments.map(c => (
        <CommentRangeMarker
          key={c.id}
          comment={c}
          durationMs={durationMs}
          dotTopOffset={overlapOffsets.get(c.id) ?? 0}
          commentMode={commentMode}
          onDelete={onCommentDelete}
          currentUserId={currentUserId}
          isOwner={isOwner}
          onReplyCreate={onReplyCreate}
          onInteractionChange={onCommentInteractionChange}
        />
      ))}

      {/* z-index 4: active drag selection rectangle */}
      {commentMode && dragRect !== null && dragSpan > 0 && (
        <>
          <div
            className="absolute top-0 bottom-0 z-[4] pointer-events-none waveform-accent-fill"
            style={{
              left: `${Math.min(dragRect.startX, dragRect.endX) * 100}%`,
              width: `${dragSpan * 100}%`,
            }}
          />
          {/* Left edge */}
          <div
            className="absolute top-0 bottom-0 z-[4] pointer-events-none waveform-accent-edge"
            style={{
              left: `${Math.min(dragRect.startX, dragRect.endX) * 100}%`,
              width: 1.5,
              opacity: 0.8,
            }}
          />
          {/* Right edge */}
          {dragSpan > 0.01 && (
            <div
              className="absolute top-0 bottom-0 z-[4] pointer-events-none waveform-accent-edge"
              style={{
                left: `${Math.max(dragRect.startX, dragRect.endX) * 100}%`,
                width: 1.5,
                opacity: 0.8,
              }}
            />
          )}
          {/* Time label above right edge */}
          {dragSpan > 0.01 && (
            <div
              className="absolute z-[4] pointer-events-none text-[10px] px-2 py-0.5 whitespace-nowrap tabular-nums bg-foreground text-background uppercase tracking-widest"
              style={{
                left: `${Math.max(dragRect.startX, dragRect.endX) * 100}%`,
                bottom: '100%',
                transform: 'translateX(-50%)',
                marginBottom: 2,
              }}
            >
              {fmtMs(Math.max(dragRect.startX, dragRect.endX) * durationMs)}
            </div>
          )}
        </>
      )}

      {/* z-index 4: active input range highlight (while comment bubble is open) */}
      {thisInputActive && activeInput && !dragRect && (
        <div
          className="absolute top-0 bottom-0 z-[4] pointer-events-none waveform-accent-fill"
          style={{
            left: `${activeInput.startXPercent * 100}%`,
            width: `${(activeInput.endXPercent - activeInput.startXPercent) * 100}%`,
            borderLeft: '1px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRight: '1px solid color-mix(in srgb, var(--accent) 80%, transparent)',
          }}
        />
      )}

      {/* z-index 5: comment input bubble (portal) */}
      {thisInputActive && activeInput && (
        <CommentInputBubble
          input={activeInput}
          onSubmit={(content) => onCommentCreate(trackId, activeInput.startMs, activeInput.endMs, content)}
          onClose={onCloseInput}
          currentUser={currentUser}
        />
      )}
    </div>
  )
}

// ─── Player hook ──────────────────────────────────────────────────────────────

/** Short gain ramp to avoid audible clicks at every source start/stop boundary. */
const RAMP_SECS = 0.008
/** Hard ceiling for the project timeline (bars) — live recording auto-extends up to this. */
const MAX_PROJECT_BARS = 1000
const RECORDING_EXTEND_CHUNK_BARS = 16
const RECORDING_EXTEND_LEAD_BARS = 4

type RehearsalPlaybackOptions = {
  enabled: boolean
  projectId: string
  isMainVersion: boolean
}

function usePlayer(
  tracks: Track[],
  versionId: string,
  project: Project | null,
  minPlaybackDuration = 0,
  timelineDurationSec = 0,
  rehearsal: RehearsalPlaybackOptions = { enabled: false, projectId: '', isMainVersion: false },
) {
  const actxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const metronomeSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const bufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  /** Updated every rAF frame — use for smooth visual updates (waveform overlays,
   *  progress bar fill). React state `currentTime` is throttled to ~5 Hz. */
  const currentTimeRef = useRef(0)
  const metronomeParamsRef = useRef<{ bpm: number; timeSig: string; duration: number } | null>(null)
  const startRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const [midiRenderingTracks, setMidiRenderingTracks] = useState<Set<string>>(() => new Set())
  const [midiPlaybackReadyIds, setMidiPlaybackReadyIds] = useState<Set<string>>(() => new Set())
  const midiRenderingTracksRef = useRef<Set<string>>(new Set())
  const midiRenderedKeysRef = useRef<Map<string, string>>(new Map())
  const midiRenderGenRef = useRef<Map<string, number>>(new Map())
  const midiRenderWaitersRef = useRef<Map<string, Array<() => void>>>(new Map())
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    const saved = parseFloat(localStorage.getItem('trackbase_volume') ?? '')
    return isNaN(saved) ? 1 : Math.max(0, Math.min(1, saved))
  })

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Incremented on every seek so RecordingTrackRow's preview effect re-runs
  // and restarts the AudioBufferSourceNode from the correct position.
  const [seekEpoch, setSeekEpoch] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [previewMixReady, setPreviewMixReady] = useState(false)
  const usingPreviewMixRef = useRef(false)
  const pendingFullMixSwitchRef = useRef(false)
  const previewFetchGenRef = useRef(0)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const previewDecodeInflightRef = useRef<Promise<AudioBuffer | null> | null>(null)
  const rehearsalRef = useRef(rehearsal)
  rehearsalRef.current = rehearsal
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set())
  const mutedTracksRef = useRef<Set<string>>(new Set())
  const [soloedTracks, setSoloedTracks] = useState<Set<string>>(new Set())
  const soloedTracksRef = useRef<Set<string>>(new Set())
  const playingRef = useRef(playing)
  playingRef.current = playing
  const [trackDurations, setTrackDurations] = useState<Map<string, number>>(new Map())
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [countdownOn, setCountdownOn] = useState(false)
  const [isCounting, setIsCounting] = useState(false)
  const metronomeOnRef = useRef(false)
  metronomeOnRef.current = metronomeOn
  const countdownOnRef = useRef(false)
  countdownOnRef.current = countdownOn
  const isCountingRef = useRef(false)
  isCountingRef.current = isCounting
  const countdownCancelRef = useRef<(() => void) | null>(null)

  type SectionLoopRange = { id: string; startBar: number; endBar: number }
  const sectionLoopRef = useRef<SectionLoopRange | null>(null)
  const [sectionLoopOn, setSectionLoopOn] = useState(false)
  const playFnRef = useRef<(offset?: number) => Promise<void>>(async () => {})
  const skipPlaybackAnalyticsRef = useRef(false)

  /** Metronome ignores solo/mute sets — only the Metro toggle controls it. */
  const gainForTrack = useCallback((
    trackId: string,
    soloSet: Set<string>,
    mutedSet: Set<string>,
  ) => {
    if (trackId === METRONOME_TRACK_ID) {
      return metronomeOnRef.current ? 1 : 0
    }
    if (trackId === PREVIEW_MIX_TRACK_ID) {
      const hasSolos = soloSet.size > 0
      return hasSolos && soloSet.has(PREVIEW_MIX_TRACK_ID) ? 1 : 0
    }
    if (midiRenderingTracksRef.current.has(trackId)) {
      return 0
    }
    const hasSolos = soloSet.size > 0
    return (hasSolos ? !soloSet.has(trackId) : mutedSet.has(trackId)) ? 0 : 1
  }, [])
  const minPlaybackDurationRef = useRef(minPlaybackDuration)
  minPlaybackDurationRef.current = minPlaybackDuration
  const timelineDurationSecRef = useRef(timelineDurationSec)
  timelineDurationSecRef.current = timelineDurationSec

  const getTransportDuration = useCallback(() => Math.max(
    duration,
    minPlaybackDurationRef.current,
    timelineDurationSecRef.current,
  ), [duration])

  // Only load audio tracks from the server; MIDI is offline-rendered client-side.
  const audioTracks = tracks.filter(t => t.file_type !== 'midi')
  const audioTrackIdsKey = useMemo(
    () => audioTracks.map(t => t.id).sort().join('|'),
    [audioTracks],
  )
  const projectBpm = project?.bpm ?? 120
  const projectTimeSig = project?.time_signature ?? '4/4'
  const midiRenderDepsKey = useMemo(() => {
    const meta = tracks
      .filter(t => t.file_type === 'midi')
      .map(t => `${t.id}:${t.file_hash ?? ''}:${t.midi_data?.instrument ?? -1}:${t.midi_data?.notes?.length ?? 0}`)
      .sort()
      .join('|')
    return `${meta}|${projectBpm}|${projectTimeSig}`
  }, [
    tracks.map(t => `${t.id}:${t.file_hash ?? ''}:${t.midi_data?.instrument ?? -1}:${t.midi_data?.notes?.length ?? 0}:${t.file_type}`).join('|'),
    projectBpm,
    projectTimeSig,
  ])
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const projectRef = useRef(project)
  projectRef.current = project

  const recomputeTransportDuration = useCallback(() => {
    const proj = projectRef.current
    if (!proj) return
    let maxDur = 0
    if (usingPreviewMixRef.current) {
      const previewAudio = previewAudioRef.current
      if (previewAudio && Number.isFinite(previewAudio.duration) && previewAudio.duration > 0) {
        maxDur = Math.max(maxDur, previewAudio.duration)
      }
      const previewBuf = bufsRef.current.get(PREVIEW_MIX_TRACK_ID)
      if (previewBuf) maxDur = Math.max(maxDur, previewBuf.duration)
    }
    for (const t of tracksRef.current) {
      const buf = bufsRef.current.get(t.id)
      maxDur = Math.max(maxDur, trackTimelineEndSec(
        t,
        proj.bpm ?? 120,
        proj.time_signature ?? '4/4',
        buf?.duration,
      ))
    }
    if (maxDur > 0) setDuration(maxDur)
  }, [])

  const clearPreviewMixPlayback = useCallback(() => {
    bufsRef.current.delete(PREVIEW_MIX_TRACK_ID)
    usingPreviewMixRef.current = false
    pendingFullMixSwitchRef.current = false
    setPreviewMixReady(false)
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.src = ''
    }
    previewAudioRef.current = null
    previewDecodeInflightRef.current = null
    if (soloedTracksRef.current.has(PREVIEW_MIX_TRACK_ID)) {
      soloedTracksRef.current = new Set()
      setSoloedTracks(new Set())
    }
  }, [])

  const switchToFullMix = useCallback(() => {
    if (!usingPreviewMixRef.current) return
    bufsRef.current.delete(PREVIEW_MIX_TRACK_ID)
    usingPreviewMixRef.current = false
    pendingFullMixSwitchRef.current = false
    setPreviewMixReady(false)
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.src = ''
    }
    previewAudioRef.current = null
    previewDecodeInflightRef.current = null
    if (soloedTracksRef.current.has(PREVIEW_MIX_TRACK_ID)) {
      soloedTracksRef.current = new Set()
      setSoloedTracks(new Set())
    }
    recomputeTransportDuration()
  }, [recomputeTransportDuration])

  const ensurePreviewMixBuffer = useCallback(async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    const existing = bufsRef.current.get(PREVIEW_MIX_TRACK_ID)
    if (existing) return existing

    if (previewDecodeInflightRef.current) {
      return previewDecodeInflightRef.current
    }

    const projectId = rehearsalRef.current.projectId
    if (!projectId) return null

    const inflight = (async () => {
      const ab = await fetchPreviewMixBuffer(projectId)
      if (!ab?.byteLength) return null
      const decoded = await ctx.decodeAudioData(ab.slice(0))
      bufsRef.current.set(PREVIEW_MIX_TRACK_ID, decoded)
      recomputeTransportDuration()
      return decoded
    })().finally(() => {
      previewDecodeInflightRef.current = null
    })

    previewDecodeInflightRef.current = inflight
    return inflight
  }, [recomputeTransportDuration])

  const trySwitchToFullMix = useCallback(() => {
    if (!pendingFullMixSwitchRef.current || !usingPreviewMixRef.current) return
    if (playingRef.current) return
    switchToFullMix()
  }, [switchToFullMix])

  const markPendingFullMixSwitchIfReady = useCallback(() => {
    const r = rehearsalRef.current
    if (!r.enabled || !r.isMainVersion || !usingPreviewMixRef.current) return
    const audioIds = tracksRef.current.filter(t => t.file_type !== 'midi')
    if (audioIds.length === 0) return
    if (!audioIds.every(t => bufsRef.current.has(t.id))) return
    pendingFullMixSwitchRef.current = true
    trySwitchToFullMix()
  }, [trySwitchToFullMix])

  const canPlayBeforeTracksLoaded = useCallback(() => {
    const r = rehearsalRef.current
    return r.enabled && r.isMainVersion && previewMixReady && usingPreviewMixRef.current
  }, [previewMixReady])

  const noteTrackDuration = useCallback((trackId: string, ms: number) => {
    if (ms <= 0) return
    setTrackDurations(prev => {
      if (prev.get(trackId) === ms) return prev
      const next = new Map(prev)
      next.set(trackId, ms)
      return next
    })
    recomputeTransportDuration()
  }, [recomputeTransportDuration])

  // Full reset when switching versions.
  const prevVersionIdRef = useRef(versionId)
  useEffect(() => {
    if (prevVersionIdRef.current === versionId) return
    prevVersionIdRef.current = versionId
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
    bufsRef.current.clear()
    midiRenderedKeysRef.current.clear()
    midiRenderGenRef.current.clear()
    midiRenderingTracksRef.current = new Set()
    setMidiRenderingTracks(new Set())
    setMidiPlaybackReadyIds(new Set())
    metronomeParamsRef.current = null
    setLoaded(0)
    setTrackDurations(new Map())
    setDuration(0)
    setPlaying(false)
    if (masterGainRef.current) {
      try { masterGainRef.current.disconnect() } catch { /* ok */ }
      masterGainRef.current = null
    }
    mutedTracksRef.current.add(METRONOME_TRACK_ID)
    setMutedTracks(prev => new Set([...prev, METRONOME_TRACK_ID]))
    setMetronomeOn(false)
    sectionLoopRef.current = null
    setSectionLoopOn(false)
    clearPreviewMixPlayback()
  }, [versionId, clearPreviewMixPlayback])

  const resolveMidiRenderWaiters = useCallback((trackId: string) => {
    const waiters = midiRenderWaitersRef.current.get(trackId)
    if (!waiters?.length) return
    midiRenderWaitersRef.current.delete(trackId)
    for (const resolve of waiters) resolve()
  }, [])

  const finishMidiRender = useCallback((
    trackId: string,
    buffer: AudioBuffer,
    renderKey: string,
  ) => {
    bufsRef.current.set(trackId, buffer)
    midiRenderedKeysRef.current.set(trackId, renderKey)
    setMidiPlaybackReadyIds(prev => new Set(prev).add(trackId))

    midiRenderingTracksRef.current.delete(trackId)
    setMidiRenderingTracks(prev => {
      if (!prev.has(trackId)) return prev
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })

    const decodedMs = Math.round(buffer.duration * 1000)
    setTrackDurations(prev => {
      const next = new Map(prev)
      next.set(trackId, decodedMs)
      return next
    })

    const nextMuted = new Set(mutedTracksRef.current)
    nextMuted.delete(trackId)
    mutedTracksRef.current = nextMuted
    setMutedTracks(nextMuted)

    recomputeTransportDuration()
    noteTrackDuration(trackId, decodedMs)
    resolveMidiRenderWaiters(trackId)

    const g = gainsRef.current.get(trackId)
    if (g) {
      const ctx = actxRef.current
      const targetVal = gainForTrack(trackId, soloedTracksRef.current, nextMuted)
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }

    if (playingRef.current) {
      void playFnRef.current(offsetRef.current)
    }
  }, [recomputeTransportDuration, resolveMidiRenderWaiters, gainForTrack, noteTrackDuration])

  const finishMidiRenderRef = useRef(finishMidiRender)
  finishMidiRenderRef.current = finishMidiRender

  // Offline-render MIDI tracks to AudioBuffers for artifact-free transport playback.
  useEffect(() => {
    const midiTracksToRender = tracksRef.current.filter(t => t.file_type === 'midi')
    if (!midiTracksToRender.length) return
    warmMidiSoundfontModule()

    const ctx = getSharedAudioContext()
    actxRef.current = ctx
    const bpm = projectRef.current?.bpm ?? 120
    const timeSig = projectRef.current?.time_signature ?? '4/4'
    let cancelled = false

    for (const track of midiTracksToRender) {
      if (!track.midi_data?.notes?.length) continue
      const renderKey = midiRenderSourceKey(track, bpm, timeSig)
      if (midiRenderedKeysRef.current.get(track.id) === renderKey && bufsRef.current.has(track.id)) {
        continue
      }
      if (midiRenderingTracksRef.current.has(track.id)) {
        continue
      }

      const gen = (midiRenderGenRef.current.get(track.id) ?? 0) + 1
      midiRenderGenRef.current.set(track.id, gen)

      const nextMuted = new Set(mutedTracksRef.current)
      nextMuted.add(track.id)
      mutedTracksRef.current = nextMuted
      setMutedTracks(nextMuted)

      midiRenderingTracksRef.current.add(track.id)
      setMidiRenderingTracks(prev => new Set(prev).add(track.id))

      if (playingRef.current) {
        const g = gainsRef.current.get(track.id)
        const ctxNow = actxRef.current
        if (g && ctxNow) {
          const now = ctxNow.currentTime
          g.gain.cancelScheduledValues(now)
          g.gain.setValueAtTime(0, now)
        }
      }

      const trackId = track.id
      void (async () => {
        try {
          const latestForRender = tracksRef.current.find(t => t.id === trackId)
          if (!latestForRender?.midi_data?.notes?.length) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            const nextMuted = new Set(mutedTracksRef.current)
            nextMuted.delete(trackId)
            mutedTracksRef.current = nextMuted
            setMutedTracks(nextMuted)
            resolveMidiRenderWaiters(trackId)
            return
          }
          const buffer = await renderMidiTrackToBuffer(ctx.sampleRate, latestForRender, bpm)
          if (cancelled || !buffer) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            const nextMuted = new Set(mutedTracksRef.current)
            nextMuted.delete(trackId)
            mutedTracksRef.current = nextMuted
            setMutedTracks(nextMuted)
            resolveMidiRenderWaiters(trackId)
            return
          }
          if (midiRenderGenRef.current.get(trackId) !== gen) return
          const latest = tracksRef.current.find(t => t.id === trackId)
          if (!latest?.midi_data?.notes?.length) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            resolveMidiRenderWaiters(trackId)
            return
          }
          const latestKey = midiRenderSourceKey(latest, bpm, timeSig)
          if (latestKey !== renderKey) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            resolveMidiRenderWaiters(trackId)
            return
          }
          finishMidiRenderRef.current(trackId, buffer, latestKey)
        } catch {
          midiRenderingTracksRef.current.delete(trackId)
          setMidiRenderingTracks(prev => {
            if (!prev.has(trackId)) return prev
            const next = new Set(prev)
            next.delete(trackId)
            return next
          })
          const nextMuted = new Set(mutedTracksRef.current)
          nextMuted.delete(trackId)
          mutedTracksRef.current = nextMuted
          setMutedTracks(nextMuted)
          resolveMidiRenderWaiters(trackId)
        }
      })()
    }

    return () => { cancelled = true }
  }, [midiRenderDepsKey, resolveMidiRenderWaiters])

  // Load audio buffers — re-runs when tracks are added/removed within a version.
  useEffect(() => {
    if (!tracks.length) {
      setLoaded(0)
      return
    }

    let cancelled = false
    const ctx = getSharedAudioContext()
    actxRef.current = ctx

    if (!masterGainRef.current) {
      const masterGain = ctx.createGain()
      masterGain.gain.value = volume
      masterGain.connect(getMasterOutput())
      masterGainRef.current = masterGain
      mutedTracksRef.current.add(METRONOME_TRACK_ID)
      setMutedTracks(prev => new Set([...prev, METRONOME_TRACK_ID]))
      setMetronomeOn(false)
    }

    for (const id of [...bufsRef.current.keys()]) {
      if (id === METRONOME_TRACK_ID || id === PREVIEW_MIX_TRACK_ID) continue
      if (!tracksRef.current.some(t => t.id === id)) {
        bufsRef.current.delete(id)
        midiRenderedKeysRef.current.delete(id)
        setMidiPlaybackReadyIds(prev => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setTrackDurations(prev => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      }
    }

    const pending = audioTracks.filter(t => !bufsRef.current.has(t.id))
    setLoaded(audioTracks.length - pending.length)

    if (pending.length === 0) {
      recomputeTransportDuration()
      markPendingFullMixSwitchIfReady()
      return () => { cancelled = true }
    }

    Promise.all(pending.map(async t => {
      try {
        const ab = await fetchTrackAudioBuffer(t.id)
        if (!ab || cancelled) {
          if (!cancelled) setLoaded(c => c + 1)
          return
        }
        const decoded = await ctx.decodeAudioData(ab)
        if (!cancelled) {
          bufsRef.current.set(t.id, decoded)
          const decodedMs = Math.round(decoded.duration * 1000)
          setTrackDurations(prev => {
            const next = new Map(prev)
            next.set(t.id, decodedMs)
            return next
          })
          setLoaded(c => c + 1)
        }
      } catch {
        if (!cancelled) setLoaded(c => c + 1)
      }
    })).then(() => {
      if (!cancelled) {
        recomputeTransportDuration()
        markPendingFullMixSwitchIfReady()
      }
    })

    return () => { cancelled = true }
  }, [versionId, audioTrackIdsKey, recomputeTransportDuration, volume, markPendingFullMixSwitchIfReady, audioTracks.length])

  // Rehearsal (main only): stream preview MP3 via Audio element (fast canplay),
  // then cache full bytes in the background for the waveform.
  useEffect(() => {
    const r = rehearsalRef.current
    if (!r.enabled || !r.isMainVersion || !r.projectId) {
      clearPreviewMixPlayback()
      return
    }

    let cancelled = false
    const gen = ++previewFetchGenRef.current
    const projectId = r.projectId

    prefetchPreviewMixPlayback(projectId)

    let audio = takePreloadedPreviewAudio(projectId)
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
    }
    previewAudioRef.current = audio

    const markReady = () => {
      if (cancelled || gen !== previewFetchGenRef.current) return
      usingPreviewMixRef.current = true
      soloedTracksRef.current = new Set([PREVIEW_MIX_TRACK_ID])
      setSoloedTracks(new Set([PREVIEW_MIX_TRACK_ID]))
      setPreviewMixReady(true)
      recomputeTransportDuration()
      markPendingFullMixSwitchIfReady()
    }

    const onCanPlay = () => {
      audio!.removeEventListener('canplay', onCanPlay)
      audio!.removeEventListener('error', onError)
      markReady()
    }
    const onError = () => {
      audio!.removeEventListener('canplay', onCanPlay)
      audio!.removeEventListener('error', onError)
      if (!cancelled && gen === previewFetchGenRef.current) clearPreviewMixPlayback()
    }

    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    const url = previewMixPlaybackUrl(projectId)
    const resolvedUrl = typeof window !== 'undefined' ? new URL(url, window.location.origin).href : url
    if (audio.src !== resolvedUrl) {
      audio.src = url
    } else if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      markReady()
    }

    const onMeta = () => recomputeTransportDuration()
    audio.addEventListener('loadedmetadata', onMeta)

    const ctx = getSharedAudioContext()
    void ensurePreviewMixBuffer(ctx)

    return () => {
      cancelled = true
      audio?.removeEventListener('canplay', onCanPlay)
      audio?.removeEventListener('error', onError)
      audio?.removeEventListener('loadedmetadata', onMeta)
    }
  }, [
    versionId,
    rehearsal.enabled,
    rehearsal.isMainVersion,
    rehearsal.projectId,
    clearPreviewMixPlayback,
    recomputeTransportDuration,
    ensurePreviewMixBuffer,
    markPendingFullMixSwitchIfReady,
  ])

  // Recompute timeline when track offsets/metadata change (without reloading audio)
  useEffect(() => {
    recomputeTransportDuration()
  }, [tracks, recomputeTransportDuration])

  // Hidden metronome track — generated once audio is loaded and timeline length is known.
  const ensureMetronomeBuffer = useCallback((ctx: AudioContext) => {
    const timelineDur = Math.max(
      duration,
      minPlaybackDurationRef.current,
      timelineDurationSecRef.current,
    )
    if (timelineDur <= 0) return
    const proj = projectRef.current
    const bpm = proj?.bpm ?? 120
    const timeSig = proj?.time_signature ?? '4/4'
    const prev = metronomeParamsRef.current
    const existing = bufsRef.current.get(METRONOME_TRACK_ID)
    const needsRegen = !existing
      || !prev
      || prev.bpm !== bpm
      || prev.timeSig !== timeSig
      || existing.duration < timelineDur - 0.05
    if (needsRegen) {
      bufsRef.current.set(
        METRONOME_TRACK_ID,
        generateMetronomeBuffer(ctx, bpm, timeSig, timelineDur),
      )
      metronomeParamsRef.current = { bpm, timeSig, duration: timelineDur }
    }
  }, [duration])

  useEffect(() => {
    const ctx = actxRef.current ?? getSharedAudioContext()
    actxRef.current = ctx
    const tracksReady = audioTracks.length === 0
      || loaded >= audioTracks.length
      || canPlayBeforeTracksLoaded()
    if (!tracksReady) return
    ensureMetronomeBuffer(ctx)
  }, [duration, loaded, audioTracks.length, project?.bpm, project?.time_signature, minPlaybackDuration, timelineDurationSec, ensureMetronomeBuffer, canPlayBeforeTracksLoaded])

  // When the timeline grows during playback (live recording), regenerate the
  // metronome buffer and reschedule its source from the current playhead.
  const prevTimelineDurRef = useRef(timelineDurationSec)
  useEffect(() => {
    const ctx = actxRef.current
    const grew = timelineDurationSec > prevTimelineDurRef.current + 0.05
    prevTimelineDurRef.current = timelineDurationSec
    if (!grew || !playingRef.current || !ctx) return

    ensureMetronomeBuffer(ctx)
    const buf = bufsRef.current.get(METRONOME_TRACK_ID)
    const g = gainsRef.current.get(METRONOME_TRACK_ID)
    if (!buf || !g || !metronomeOnRef.current) return

    const elapsed = ctx.currentTime - startRef.current
    if (elapsed < 0 || elapsed >= buf.duration) return

    if (metronomeSrcRef.current) {
      try { metronomeSrcRef.current.stop() } catch { /* ok */ }
      sourcesRef.current = sourcesRef.current.filter(s => s !== metronomeSrcRef.current)
      metronomeSrcRef.current = null
    }

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(g)
    src.start(ctx.currentTime, elapsed)
    sourcesRef.current.push(src)
    metronomeSrcRef.current = src
  }, [timelineDurationSec, ensureMetronomeBuffer])

  const stopSourcesImmediate = useCallback(() => {
    countdownCancelRef.current?.()
    countdownCancelRef.current = null
    isCountingRef.current = false

    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    metronomeSrcRef.current = null
    previewAudioRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    gainsRef.current.forEach(g => {
      try { g.disconnect() } catch { /* ok */ }
    })
    gainsRef.current.clear()
    if (masterGainRef.current) {
      try { masterGainRef.current.disconnect() } catch { /* ok */ }
      masterGainRef.current = null
    }
  }, [])

  const stopSources = useCallback(() => {
    const ctx = actxRef.current
    if (ctx && sourcesRef.current.length > 0) {
      const now = ctx.currentTime
      gainsRef.current.forEach(g => {
        try {
          g.gain.cancelScheduledValues(now)
          g.gain.setValueAtTime(g.gain.value, now)
          g.gain.linearRampToValueAtTime(0, now + RAMP_SECS)
        } catch { /* ok */ }
      })
      const toStop = [...sourcesRef.current]
      sourcesRef.current = []
      metronomeSrcRef.current = null
      cancelAnimationFrame(rafRef.current)
      previewAudioRef.current?.pause()
      setTimeout(() => {
        toStop.forEach(s => { try { s.stop() } catch { /* ok */ } })
      }, RAMP_SECS * 1000 + 4)
      return
    }
    stopSourcesImmediate()
  }, [stopSourcesImmediate])

  useEffect(() => {
    const cleanup = () => {
      stopSourcesImmediate()
      setPlaying(false)
      setIsCounting(false)
    }
    const unregister = registerPlaybackStop(cleanup)
    return () => {
      unregister()
      cleanup()
    }
  }, [stopSourcesImmediate])

  const ensurePlaybackGraph = useCallback(() => {
    const ctx = getSharedAudioContext()
    actxRef.current = ctx
    if (!masterGainRef.current || masterGainRef.current.context !== ctx) {
      if (masterGainRef.current) {
        try { masterGainRef.current.disconnect() } catch { /* ok */ }
      }
      const masterGain = ctx.createGain()
      masterGain.gain.value = volume
      masterGain.connect(getMasterOutput())
      masterGainRef.current = masterGain
    }
    return ctx
  }, [volume])

  const play = useCallback(async (
    offset = offsetRef.current,
    tracksOverride?: Track[],
    scheduledStartTime?: number,
  ) => {
    const wasPlaying = playingRef.current
    const trackPlayback = !skipPlaybackAnalyticsRef.current
    skipPlaybackAnalyticsRef.current = false
    stopSources()
    const ctx = ensurePlaybackGraph()
    ensureMetronomeBuffer(ctx)
    if (ctx.state === 'suspended') await ctx.resume()

    if (usingPreviewMixRef.current) {
      await ensurePreviewMixBuffer(ctx)
    }

    const newGains = new Map<string, GainNode>()
    const proj = projectRef.current
    const projBpmP = proj?.bpm ?? 120
    const projBeatsP = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
    const projBarDurSecP = (60 / projBpmP) * projBeatsP
    const allTracks = tracksOverride ?? tracksRef.current
    const trackMetaMap = new Map(allTracks.map(t => [t.id, t]))

    const audioCtxPlayTime = scheduledStartTime != null
      ? Math.max(scheduledStartTime, ctx.currentTime)
      : ctx.currentTime

    bufsRef.current.forEach((buf, id) => {
      const isMetronome = id === METRONOME_TRACK_ID
      const isPreviewMix = id === PREVIEW_MIX_TRACK_ID
      const trackMeta = isMetronome || isPreviewMix ? null : trackMetaMap.get(id)
      if (!isMetronome && !isPreviewMix && !trackMeta) return
      const trackOffsetSec = (isMetronome || isPreviewMix)
        ? 0
        : (trackMeta!.start_bar ?? trackMeta!.midi_start_bar ?? 0) * projBarDurSecP
      const trackEndSec = trackOffsetSec + buf.duration
      // Skip tracks that end before the playback position
      if (trackEndSec <= offset) return
      const g = ctx.createGain()
      const targetGain = gainForTrack(id, soloedTracksRef.current, mutedTracksRef.current)
      // Ramp from 0 → target over RAMP_SECS to avoid start-of-playback click
      g.gain.setValueAtTime(0, audioCtxPlayTime)
      g.gain.linearRampToValueAtTime(targetGain, audioCtxPlayTime + RAMP_SECS)
      g.connect(masterGainRef.current ?? ctx.destination)
      newGains.set(id, g)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(g)
      if (offset <= trackOffsetSec) {
        // Playback position is before this track — schedule delayed start
        src.start(audioCtxPlayTime + (trackOffsetSec - offset), 0)
      } else {
        // Playback position is inside this track — start immediately from offset into buffer
        src.start(audioCtxPlayTime, offset - trackOffsetSec)
      }
      sourcesRef.current.push(src)
      if (isMetronome) metronomeSrcRef.current = src
    })
    gainsRef.current = newGains
    startRef.current = audioCtxPlayTime - offset
    offsetRef.current = offset
    setPlaying(true)
    if (trackPlayback && !wasPlaying) trackEvent('playback_started')
    // Track last tick bucket for 5 Hz state throttle (avoids 60fps React re-renders)
    let lastStateTick = -1
    const tick = () => {
      const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
      const dur = getTransportDuration() || 1
      currentTimeRef.current = elapsed

      const loop = sectionLoopRef.current
      if (loop) {
        const proj = projectRef.current
        const loopBpm = proj?.bpm ?? 120
        const loopBeats = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
        const loopBarDur = (60 / loopBpm) * loopBeats
        const loopEnd = loop.endBar * loopBarDur
        if (elapsed >= loopEnd - 0.002) {
          skipPlaybackAnalyticsRef.current = true
          void playFnRef.current(loop.startBar * loopBarDur)
          return
        }
      }

      if (elapsed >= dur) { currentTimeRef.current = 0; setPlaying(false); setCurrentTime(0); offsetRef.current = 0; return }
      // Throttle React state to ~5 Hz so text display updates smoothly but cheaply.
      const bucket = Math.floor(elapsed * 5)
      if (bucket !== lastStateTick) {
        lastStateTick = bucket
        setCurrentTime(elapsed)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [getTransportDuration, stopSources, ensurePlaybackGraph, ensureMetronomeBuffer, gainForTrack, ensurePreviewMixBuffer])

  playFnRef.current = play

  const clearSectionLoop = useCallback(() => {
    sectionLoopRef.current = null
    setSectionLoopOn(false)
  }, [])

  const setSectionLoop = useCallback((range: SectionLoopRange | null) => {
    sectionLoopRef.current = range
    setSectionLoopOn(range !== null)
  }, [])

  const toggleSectionLoop = useCallback((range: SectionLoopRange | null) => {
    if (sectionLoopRef.current) {
      clearSectionLoop()
      return false
    }
    if (!range) return false
    sectionLoopRef.current = range
    setSectionLoopOn(true)
    return true
  }, [clearSectionLoop])

  const pause = useCallback(() => {
    if (isCountingRef.current) {
      isCountingRef.current = false
      setIsCounting(false)
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      return
    }
    const wasPlaying = playingRef.current
    offsetRef.current = (actxRef.current?.currentTime ?? 0) - startRef.current
    currentTimeRef.current = offsetRef.current
    playingRef.current = false
    stopSources()
    setPlaying(false)
    if (wasPlaying) trackEvent('playback_paused')
    trySwitchToFullMix()
  }, [stopSources, trySwitchToFullMix])

  const seek = useCallback((t: number, tracksOverride?: Track[]) => {
    trackEvent('playback_seeked')
    offsetRef.current = t
    currentTimeRef.current = t
    const loop = sectionLoopRef.current
    if (loop) {
      const proj = projectRef.current
      const barDur = ((60 / (proj?.bpm ?? 120)) * (parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4))
      const bar = Math.floor(t / barDur)
      if (bar < loop.startBar || bar >= loop.endBar) clearSectionLoop()
    }
    setSeekEpoch(e => e + 1)
    if (playing) play(t, tracksOverride)
    else setCurrentTime(t)
  }, [playing, play, clearSectionLoop])

  const toggleMute = useCallback((id: string) => {
    if (midiRenderingTracksRef.current.has(id)) return
    const next = new Set(mutedTracksRef.current)
    const muting = !next.has(id)
    if (muting) next.add(id)
    else next.delete(id)
    mutedTracksRef.current = next
    setMutedTracks(next)
    if (muting) trackEvent('track_muted')

    const g = gainsRef.current.get(id)
    if (g) {
      const ctx = actxRef.current
      const targetVal = gainForTrack(id, soloedTracksRef.current, next)
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }
  }, [gainForTrack])

  const toggleSolo = useCallback((id: string) => {
    const next = new Set(soloedTracksRef.current)
    const enabling = !next.has(id)
    if (enabling) next.add(id)
    else next.delete(id)
    soloedTracksRef.current = next
    setSoloedTracks(next)
    trackEvent('track_solo_toggled', { enabled: enabling })

    // Soloing one track affects ALL gain nodes — update them all at once.
    const ctx = actxRef.current
    const now = ctx?.currentTime
    gainsRef.current.forEach((g, trackId) => {
      const targetVal = gainForTrack(trackId, next, mutedTracksRef.current)
      if (ctx && now !== undefined) {
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    })
  }, [gainForTrack])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    if (masterGainRef.current) masterGainRef.current.gain.value = v
    if (typeof window !== 'undefined') localStorage.setItem('trackbase_volume', String(v))
  }, [])

  const toggleMetronome = useCallback(() => {
    const next = !metronomeOnRef.current
    metronomeOnRef.current = next
    setMetronomeOn(next)
    trackEvent('metronome_toggled', { enabled: next })
    const nextMuted = new Set(mutedTracksRef.current)
    if (next) nextMuted.delete(METRONOME_TRACK_ID)
    else nextMuted.add(METRONOME_TRACK_ID)
    mutedTracksRef.current = nextMuted
    setMutedTracks(nextMuted)
    const g = gainsRef.current.get(METRONOME_TRACK_ID)
    if (g) {
      const ctx = actxRef.current
      const targetVal = next ? 1 : 0
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }
  }, [])

  const toggleCountdown = useCallback(() => setCountdownOn(c => !c), [])

  const prepareTransport = useCallback(() => {
    const ctx = ensurePlaybackGraph()
    if (ctx.state === 'suspended') void ctx.resume()
    ensureMetronomeBuffer(ctx)
  }, [ensurePlaybackGraph, ensureMetronomeBuffer])

  const snapPlayheadToBar = useCallback((positionSec: number) => {
    const proj = projectRef.current
    const snapped = snapToPreviousBarSec(
      positionSec,
      proj?.bpm ?? 120,
      proj?.time_signature ?? '4/4',
    )
    offsetRef.current = snapped
    currentTimeRef.current = snapped
    setCurrentTime(snapped)
    return snapped
  }, [])

  const playWithCountIn = useCallback(async (offset = offsetRef.current, tracksOverride?: Track[]) => {
    const waitingForTracks = audioTracks.length > 0 && loaded < audioTracks.length
    if (waitingForTracks && !canPlayBeforeTracksLoaded()) return
    if (isCountingRef.current) return

    const snapped = snapPlayheadToBar(offset)

    if (countdownOnRef.current) {
      const ctx = ensurePlaybackGraph()
      const proj = projectRef.current
      if (ctx.state === 'suspended') await ctx.resume()
      isCountingRef.current = true
      setIsCounting(true)
      const out = masterGainRef.current ?? ctx.destination
      const { promise, cancel } = startCountdown(
        ctx,
        out,
        proj?.bpm ?? 120,
        proj?.time_signature ?? '4/4',
      )
      countdownCancelRef.current = cancel
      await promise
      countdownCancelRef.current = null
      if (!isCountingRef.current) return
      setIsCounting(false)
    }
    await play(snapped, tracksOverride)
  }, [play, ensurePlaybackGraph, loaded, audioTracks.length, snapPlayheadToBar, canPlayBeforeTracksLoaded])

  const playbackReady = audioTracks.length === 0
    || loaded >= audioTracks.length
    || canPlayBeforeTracksLoaded()

  const playbackMix: 'preview' | 'full' | 'none' = previewMixReady
    ? 'preview'
    : audioTracks.length > 0
      ? 'full'
      : 'none'

  const waitForMidiRender = useCallback((trackId: string) => {
    const proj = projectRef.current
    const track = tracksRef.current.find(t => t.id === trackId)
    if (!track?.midi_data?.notes?.length) return Promise.resolve()
    const renderKey = midiRenderSourceKey(track, proj?.bpm ?? 120, proj?.time_signature ?? '4/4')
    const ready = midiRenderedKeysRef.current.get(trackId) === renderKey
      && bufsRef.current.has(trackId)
      && !midiRenderingTracksRef.current.has(trackId)
    if (ready) return Promise.resolve()
    return new Promise<void>(resolve => {
      const list = midiRenderWaitersRef.current.get(trackId) ?? []
      list.push(resolve)
      midiRenderWaitersRef.current.set(trackId, list)
    })
  }, [])

  return {
    playing, currentTime,
    duration: getTransportDuration(),
    loaded, total: audioTracks.length,
    playbackReady,
    playbackMix,
    midiRenderingTracks,
    midiPlaybackReadyIds,
    waitForMidiRender,
    mutedTracks, soloedTracks, volume, setVolume,
    play: () => playWithCountIn(),
    playTransport: (scheduledStartTime?: number) => {
      const waitingForTracks = audioTracks.length > 0 && loaded < audioTracks.length
      if (waitingForTracks && !canPlayBeforeTracksLoaded()) return
      const snapped = snapPlayheadToBar(offsetRef.current)
      return play(snapped, undefined, scheduledStartTime)
    },
    prepareTransport,
    playWithCountIn,
    pause, seek, seekEpoch, toggleMute, toggleSolo,
    metronomeOn, countdownOn, isCounting, toggleMetronome, toggleCountdown,
    sectionLoopOn, toggleSectionLoop, clearSectionLoop, setSectionLoop,
    audioContext: actxRef, trackDurations,
    /** Ref updated every rAF frame. Use for smooth DOM-direct visual updates. */
    currentTimeRef,
    noteTrackDuration,
  }
}

// ─── Track letter buttons ─────────────────────────────────────────────────────

function TrackLetterBtn({
  letter, tooltip, active, onClick, activeClass, disabled = false,
}: {
  letter: string
  tooltip: string
  active?: boolean
  onClick?: () => void
  activeClass?: string
  disabled?: boolean
}) {
  return (
    <HoverTooltip label={tooltip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`size-5 border text-[9px] font-medium grid place-items-center transition uppercase disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active && activeClass ? activeClass : 'border-border hover:border-lime hover:text-lime text-muted-foreground'
        }`}
      >
        {letter}
      </button>
    </HoverTooltip>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  label, onClick, href, tooltip, danger,
}: {
  label: string
  onClick?: () => void
  href?: string
  tooltip: string
  danger?: boolean
}) {
  const className = `size-5 border text-[9px] font-medium grid place-items-center transition uppercase ${
    danger
      ? 'border-border text-muted-foreground hover:border-destructive hover:text-destructive hover:bg-destructive/10'
      : 'border-border text-muted-foreground hover:border-lime hover:text-lime hover:bg-lime-soft'
  }`

  return (
    <HoverTooltip label={tooltip} className="shrink-0">
      {href ? (
        <a href={href} download className={className}>{label}</a>
      ) : (
        <button type="button" onClick={onClick} className={className}>{label}</button>
      )}
    </HoverTooltip>
  )
}

function TrackIconBtn({
  tooltip, onClick, href, danger, children,
}: {
  tooltip: string
  onClick?: () => void
  href?: string
  danger?: boolean
  children: ReactNode
}) {
  const className = `size-5 border grid place-items-center transition ${
    danger
      ? 'border-border text-muted-foreground hover:border-destructive hover:text-destructive'
      : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
  }`

  return (
    <HoverTooltip label={tooltip}>
      {href ? (
        <a href={href} download className={className} aria-label={tooltip}>{children}</a>
      ) : (
        <button type="button" onClick={onClick} className={className} aria-label={tooltip}>{children}</button>
      )}
    </HoverTooltip>
  )
}

function ReplaceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Track color picker ───────────────────────────────────────────────────────

function TrackColorPicker({ trackId, initialColor, onApply, onClose }: {
  trackId: string
  initialColor: string
  onApply: (color: string) => void
  onClose: () => void
}) {
  const [color, setColor] = useState(initialColor)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const swatches = getTrackIconSwatches()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  async function handleApply() {
    setSaving(true)
    try {
      await fetch(`/api/tracks/${trackId}/icon`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icon_color: color }),
      })
      onApply(color)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 z-50 mt-1 w-52 border border-border bg-surface p-3 shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 m-0">Track color</p>
      <div className="grid grid-cols-5 gap-1.5 mb-3">
        {swatches.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`size-6 rounded-sm transition-transform ${color === c ? 'ring-2 ring-lime ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'}`}
            style={{ background: c }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <div
          className="size-7 grid place-items-center text-[10px] font-bold text-white uppercase"
          style={{ background: color }}
        >
          A
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Preview</span>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-[10px] uppercase tracking-widest border border-border px-2 py-1 text-muted-foreground hover:border-lime hover:text-lime"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={saving}
          className="text-[10px] uppercase tracking-widest bg-lime text-primary-foreground px-2 py-1 font-bold disabled:opacity-60"
        >
          {saving ? '…' : 'Apply'}
        </button>
      </div>
    </div>
  )
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────

const TrackRow = React.memo(function TrackRow({
  track, index, muted, soloed, changed, currentTimeRef,
  commentMode, activeInput, audioReady, midiRendering,
  onToggleMute, onToggleSolo, onReplace,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput,
  onDeleteTrack, onRenameTrack, onColorUpdate, onMidiDataUpdate, onStartBarUpdate,
  onDragStartOffset, onDragEndOffset, otherTrackDragging, waveformDimmed,
  waveformsInteractive = true,
  currentUserId, isOwner, onReplyCreate, currentUser,
  projectId, versionId, project, totalBars, runtimeDurationMs,
  timelineDurationMs, onTrackDuration, waitForMidiRender,
  compact = false,
  resourceFilterActive = false,
  onResourceFilter,
}: {
  track: Track; index: number; muted: boolean; soloed: boolean; changed: boolean
  /** Ref updated every rAF frame — read directly by DOM updates, never triggers re-render. */
  currentTimeRef: React.RefObject<number>; commentMode: boolean
  activeInput: ActiveCommentInput | null; audioReady: boolean
  midiRendering?: boolean
  onToggleMute: () => void; onToggleSolo: () => void; onReplace: (f: File) => void
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onDeleteTrack: (trackId: string) => Promise<void>
  onRenameTrack: (trackId: string, newName: string) => void
  onColorUpdate: (trackId: string, color: string) => void
  onMidiDataUpdate: (trackId: string, updates: Partial<Track>) => void
  onStartBarUpdate: (trackId: string, startBar: number) => Promise<void>
  onDragStartOffset: () => void
  onDragEndOffset: () => void
  otherTrackDragging: boolean
  /** Dim waveform row like offset-drag when muted or ducked by solo. */
  waveformDimmed: boolean
  /** False while audio/MIDI tracks are still loading — blocks offset & comment drag. */
  waveformsInteractive: boolean
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUser: { username: string } | null
  projectId: string
  versionId: string
  project: Project
  totalBars: number
  runtimeDurationMs: number
  /** Total project duration in ms — passed to TactGrid for time-based positioning that matches the ruler. */
  timelineDurationMs?: number
  onTrackDuration?: (trackId: string, durationMs: number) => void
  waitForMidiRender: (trackId: string) => Promise<void>
  compact?: boolean
  resourceFilterActive?: boolean
  onResourceFilter?: (trackId: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const accentColor = trackAccentColor(track.icon_color, index)
  const isMidi = track.file_type === 'midi'

  // All state/refs must come before computed values that read state
  const [waveformReady, setWaveformReady] = useState(false)
  useEffect(() => { setWaveformReady(false) }, [track.id])
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [rowHovered, setRowHovered] = useState(false)
  const [pianoRollOpen, setPianoRollOpen] = useState(false)
  // Drag-to-offset state
  const [isOffsetDragging, setIsOffsetDragging] = useState(false)
  const [dragPreviewBar, setDragPreviewBar] = useState<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragMovedRef = useRef(false)
  const origStartBarRef = useRef(0)
  const dragPreviewBarRef = useRef<number | null>(null)
  const waveformColRef = useRef<HTMLDivElement>(null)
  /** Ref to the inner waveform clip container — updated directly during drag. */
  const waveformClipRef = useRef<HTMLDivElement>(null)
  /** Ref to the snap-indicator line inside the waveform column. */
  const snapIndicatorRef = useRef<HTMLDivElement>(null)
  /** Ref to the bar-number label inside the snap indicator — updated DOM-directly during drag. */
  const snapBarLabelRef = useRef<HTMLSpanElement>(null)
  const trackLabelColRef = useRef<HTMLDivElement>(null)
  const trackRowRef = useRef<HTMLDivElement>(null)
  /** Pending clientX for rAF-throttled drag move. */
  const pendingDragXRef = useRef<number | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const commentUiActiveRef = useRef(false)
  const activeCommentInteractionsRef = useRef(new Set<string>())

  const handleCommentInteractionChange = useCallback((commentId: string, active: boolean) => {
    if (active) activeCommentInteractionsRef.current.add(commentId)
    else activeCommentInteractionsRef.current.delete(commentId)
    commentUiActiveRef.current = activeCommentInteractionsRef.current.size > 0
  }, [])

  function syncLabelColOpacity(bar: number) {
    if (trackLabelColRef.current) {
      trackLabelColRef.current.style.opacity = bar < 0 ? '0.45' : ''
    }
  }

  function resetLabelColOpacity() {
    if (trackLabelColRef.current) {
      trackLabelColRef.current.style.opacity = ''
    }
  }

  function cancelOffsetDrag() {
    setIsOffsetDragging(false)
    onDragEndOffset()
    dragPreviewBarRef.current = null
    setDragPreviewBar(null)
    dragMovedRef.current = false
    resetLabelColOpacity()
  }

  // Cancel track-offset drag when the user interacts with portaled comment UI
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!isCommentUiTarget(e.target)) return
      commentUiActiveRef.current = true
      if (isOffsetDragging) cancelOffsetDrag()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffsetDragging, onDragEndOffset])

  // Per-track offset and timing (uses dragPreviewBar state above)
  const projBpmRow = project.bpm ?? 120
  const projTimeSigRow = project.time_signature ?? '4/4'
  const beatsPerBarRow = parseInt(projTimeSigRow.split('/')[0]) || 4
  const barDurationMsRow = (60000 / projBpmRow) * beatsPerBarRow
  const effectiveStartBar = dragPreviewBar ?? (track.start_bar ?? 0)
  const trackOffsetMs = effectiveStartBar * barDurationMsRow
  // Prefer runtime decoded duration (populated once audio buffer loads); fall back to DB value.
  const rawContentMs = trackContentDurationMs(track, projBpmRow, runtimeDurationMs)
  const durationKnown = rawContentMs > 0
  const trackDurationBars = durationKnown
    ? durationMsToBars(rawContentMs, projBpmRow, projTimeSigRow)
    : Math.max(1, totalBars - effectiveStartBar)
  const trackOwnDurationMs = durationKnown
    ? rawContentMs
    : trackDurationBars * barDurationMsRow

  // Waveform column layout
  const startPercent = totalBars > 0 ? (effectiveStartBar / totalBars) * 100 : 0
  const widthPercent = totalBars > 0 ? Math.max(1, (trackDurationBars / totalBars) * 100) : 100
  // Scale bar count so each bar stays ~12px wide regardless of clip length.
  const displayBarCount = Math.max(4, Math.round(96 * (trackDurationBars / Math.max(1, totalBars))))
  const isAudioLoading = !isMidi && !waveformReady
  // Only expand to fill the remaining timeline while loading if we don't yet know the
  // clip's duration — prevents a flash-to-full-width when duration_ms is already stored.
  const layoutWidthPercent = isAudioLoading && !durationKnown
    ? Math.max(widthPercent, 100 - startPercent)
    : widthPercent

  const labelColW = compact ? 140 : TRACK_LABEL_W
  const clipLayout = trackClipRowStyle(labelColW, totalBars, effectiveStartBar, layoutWidthPercent)

  async function snapStartBar(startBar: number) {
    if (startBar === (track.start_bar ?? 0)) return
    try {
      await onStartBarUpdate(track.id, startBar)
    } catch { /* ignore */ }
  }

  function syncSnapIndicator(newBar: number) {
    const rowEl = trackRowRef.current
    const lineEl = snapIndicatorRef.current
    const labelEl = snapBarLabelRef.current
    if (!rowEl || !lineEl || !labelEl) return

    const rowWidth = rowEl.offsetWidth
    const clipLeft = trackClipRowLeft(labelColW, totalBars, newBar)
    const clipLeftPx = trackClipLeftPx(labelColW, totalBars, newBar, rowWidth)

    lineEl.style.left = clipLeft
    labelEl.textContent = formatTrackStartBar(newBar)

    // Snap line under the thumb — show bar count at the visible waveform edge instead.
    const underThumb = clipLeftPx < labelColW
    labelEl.style.left = underThumb ? `${labelColW + 6}px` : `${clipLeftPx + 6}px`
  }

  useLayoutEffect(() => {
    if (!isOffsetDragging) return
    const bar = dragPreviewBarRef.current ?? dragPreviewBar ?? track.start_bar ?? 0
    syncSnapIndicator(bar)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffsetDragging])

  // Drag-to-offset handlers (mouse + touch)
  function startOffsetDrag(clientX: number) {
    if (!waveformsInteractive || commentMode || commentUiActiveRef.current) return
    dragStartXRef.current = clientX
    dragMovedRef.current = false
    origStartBarRef.current = track.start_bar ?? 0
    const initialBar = track.start_bar ?? 0
    setIsOffsetDragging(true)
    dragPreviewBarRef.current = initialBar
    setDragPreviewBar(initialBar)
    syncLabelColOpacity(initialBar)
    const clipLeft = trackClipRowLeft(labelColW, totalBars, initialBar)
    if (waveformClipRef.current) waveformClipRef.current.style.left = clipLeft
    syncSnapIndicator(initialBar)
    onDragStartOffset()
  }

  function handleOffsetMouseDown(e: React.MouseEvent) {
    if (isCommentUiTarget(e.target) || commentUiActiveRef.current) return
    e.preventDefault()
    e.stopPropagation()
    startOffsetDrag(e.clientX)
  }

  function handleOffsetTouchStart(e: React.TouchEvent) {
    if (isCommentUiTarget(e.target) || commentUiActiveRef.current) return
    e.preventDefault()
    e.stopPropagation()
    startOffsetDrag(e.touches[0].clientX)
  }

  useEffect(() => {
    if (!isOffsetDragging) return

    // Reads the container width once per drag start — avoids getBoundingClientRect inside hot path.
    const colEl = waveformColRef.current
    const containerWidth = colEl?.offsetWidth ?? 1
    const barsPerPixel = totalBars / containerWidth

    function applyDragPosition(clientX: number) {
      const deltaX = clientX - dragStartXRef.current
      if (Math.abs(deltaX) > 3) dragMovedRef.current = true
      const newBar = clampTrackStartBar(
        origStartBarRef.current + deltaX * barsPerPixel,
        trackDurationBars,
      )
      dragPreviewBarRef.current = newBar
      // DOM-direct update — no React state, no re-render per frame.
      if (waveformClipRef.current) {
        waveformClipRef.current.style.left = trackClipRowLeft(labelColW, totalBars, newBar)
      }
      syncSnapIndicator(newBar)
      syncLabelColOpacity(newBar)
    }

    function onMouseMove(e: MouseEvent) {
      pendingDragXRef.current = e.clientX
      if (dragRafRef.current !== null) return
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null
        if (pendingDragXRef.current !== null) applyDragPosition(pendingDragXRef.current)
      })
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      pendingDragXRef.current = e.touches[0].clientX
      if (dragRafRef.current !== null) return
      dragRafRef.current = requestAnimationFrame(() => {
        dragRafRef.current = null
        if (pendingDragXRef.current !== null) applyDragPosition(pendingDragXRef.current)
      })
    }

    async function onDragEnd(e: MouseEvent | TouchEvent) {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
        dragRafRef.current = null
      }
      const endTarget = 'changedTouches' in e
        ? e.changedTouches[0]?.target ?? null
        : e.target

      if (isCommentUiTarget(endTarget) || commentUiActiveRef.current) {
        cancelOffsetDrag()
        return
      }

      setIsOffsetDragging(false)
      onDragEndOffset()

      if (!dragMovedRef.current) {
        dragPreviewBarRef.current = null
        setDragPreviewBar(null)
        resetLabelColOpacity()
        return
      }

      let newBar = dragPreviewBarRef.current
      if (newBar !== null) {
        newBar = clampTrackStartBar(newBar, trackDurationBars)
        dragPreviewBarRef.current = newBar
      }
      dragPreviewBarRef.current = null
      // Commit final position as React state (one re-render at drag end).
      setDragPreviewBar(newBar)
      if (newBar !== null && newBar !== (track.start_bar ?? 0)) {
        await snapStartBar(newBar)
      }
      setDragPreviewBar(null)
      resetLabelColOpacity()
    }
    function onMouseUp(e: MouseEvent) { void onDragEnd(e) }
    function onTouchEnd(e: TouchEvent) { void onDragEnd(e) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      if (dragRafRef.current !== null) { cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null }
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffsetDragging, totalBars, trackDurationBars, labelColW])

  // ── Inline rename ──────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [nameFlash, setNameFlash] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const displayName = track.display_name ?? track.name

  function startEdit() {
    setEditValue(displayName)
    setEditing(true)
    setTimeout(() => { renameInputRef.current?.select() }, 0)
  }

  async function commitRename() {
    const trimmed = editValue.trim()
    setEditing(false)
    if (!trimmed || trimmed === displayName) return
    try {
      const res = await fetch(`/api/tracks/${track.id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        onRenameTrack(track.id, trimmed)
        setNameFlash(true)
        setTimeout(() => setNameFlash(false), 400)
      }
    } catch { /* ignore */ }
  }

  const rowBg = deleteError
    ? 'rgba(239,68,68,0.12)'
    : confirmDelete
    ? 'rgba(239,68,68,0.06)'
    : rowHovered && !commentMode
    ? 'var(--bg-surface)'
    : 'transparent'
  const waveformOpacity = otherTrackDragging || waveformDimmed ? 0.5 : 1

  async function handleConfirmDelete() {
    setDeleting(true)
    try {
      await onDeleteTrack(track.id)
    } catch {
      setDeleteError(true)
      setDeleting(false)
      setTimeout(() => { setDeleteError(false); setConfirmDelete(false) }, 1500)
    }
  }

  const trackLetter = (displayName.trim()[0] ?? '?').toUpperCase()
  const rowH = compact ? COMPACT_TRACK_ROW_H : TRACK_ROW_H

  return (
    <>
    <div
      ref={trackRowRef}
      data-track-row={track.id}
      className={`relative flex group/track hover:bg-surface/30 overflow-visible border-b border-border ${
        showColorPicker ? 'z-30' : ''
      } ${
        resourceFilterActive ? 'bg-lime-soft/40 ring-1 ring-inset ring-lime/40' : ''
      }`}
      style={{
        minHeight: rowH,
        background: rowBg,
        boxShadow: isOffsetDragging
          ? '0 2px 8px rgba(0,0,0,0.15)'
          : confirmDelete || deleteError
          ? 'inset 0 0 0 0.5px rgba(239,68,68,0.2)'
          : 'none',
        borderBottom: pianoRollOpen ? 'none' : undefined,
        transition: 'background 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button, input, a, textarea, [data-no-resource-filter]')) return
        onResourceFilter?.(track.id)
      }}
    >
      {/* Label column — dimmed when track pre-roll extends before bar 1 */}
      <div
        ref={trackLabelColRef}
        className={`relative z-10 shrink-0 border-r border-border bg-background flex flex-col justify-between ${compact ? 'p-2' : 'p-3'} cursor-pointer`}
        style={{
          width: labelColW,
          transition: 'opacity 0.15s',
        }}
      >
        <div className="flex items-start gap-2 min-w-0">
          <div className={`relative shrink-0 ${showColorPicker ? 'z-50' : ''}`}>
            <button
              type="button"
              onClick={() => setShowColorPicker(p => !p)}
              title="Change track color"
              className={`grid place-items-center font-bold text-white uppercase transition-opacity hover:opacity-85 ${compact ? 'size-5 text-[9px]' : 'size-6 text-[10px]'}`}
              style={{ background: accentColor }}
            >
              {trackLetter}
            </button>
            {showColorPicker && (
              <TrackColorPicker
                trackId={track.id}
                initialColor={accentColor}
                onApply={(c) => { onColorUpdate(track.id, c); setShowColorPicker(false) }}
                onClose={() => setShowColorPicker(false)}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                ref={renameInputRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value.slice(0, 40))}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') { setEditing(false) }
                }}
                onBlur={commitRename}
                className="w-full bg-background border border-lime px-1.5 py-0.5 text-xs uppercase outline-none"
              />
            ) : (
              <div className="flex items-center gap-1 min-w-0" onDoubleClick={startEdit}>
                <div
                  className={`tb-type-name text-sm uppercase tracking-tight truncate transition-colors ${
                    nameFlash ? 'text-lime' : 'text-foreground'
                  }`}
                >
                  {displayName}
                </div>
                {isMidi && (
                  <span className="text-[8px] uppercase tracking-widest text-lime border border-lime/40 px-1 shrink-0">
                    MIDI
                  </span>
                )}
              </div>
            )}
            {!compact && (
            <div className="mt-0.5">
              {changed ? (
                <span className="text-[9px] uppercase tracking-widest text-amber">Modified</span>
              ) : isMidi && track.midi_data ? (
                <span className="text-[9px] text-muted-foreground truncate block font-mono">
                  {midiRendering
                    ? 'Rendering audio…'
                    : `${track.midi_data.notes.length} notes · ${trackDurationBars} bars`}
                  {!midiRendering && (track.start_bar ?? 0) !== 0
                    ? ` · ${formatTrackStartBar(track.start_bar ?? 0)}`
                    : ''}
                </span>
              ) : isMidi ? (
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Loading…</span>
              ) : (
                <span className="text-[9px] text-muted-foreground truncate block font-mono">
                  {track.original_filename ?? '—'}
                  {track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
                  {(track.start_bar ?? 0) !== 0
                    ? ` · ${formatTrackStartBar(track.start_bar ?? 0)}`
                    : ''}
                </span>
              )}
            </div>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-1 ${compact ? 'mt-1' : 'mt-2'}`}>
          <TrackLetterBtn
            letter="M"
            tooltip={midiRendering ? 'Rendering audio…' : 'Mute'}
            active={muted}
            activeClass="bg-lime text-primary-foreground border-lime"
            onClick={onToggleMute}
            disabled={midiRendering}
          />
          <TrackLetterBtn
            letter="S"
            tooltip="Solo"
            active={soloed}
            activeClass="bg-chart-4 text-background border-chart-4"
            onClick={onToggleSolo}
          />
          {isMidi && !compact && (
            <button
              type="button"
              onClick={() => setPianoRollOpen(p => !p)}
              className="text-[9px] uppercase tracking-widest border border-border text-muted-foreground hover:border-lime hover:text-lime px-1.5 py-0.5 transition"
            >
              {pianoRollOpen ? 'Close' : 'Edit'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <span className="text-[9px] uppercase tracking-widest text-destructive whitespace-nowrap">Delete?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-5 px-1.5 border border-border text-[9px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime transition"
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="h-5 px-1.5 border border-destructive bg-destructive text-white text-[9px] uppercase tracking-widest disabled:opacity-60 transition"
                >
                  {deleting ? '…' : 'Yes'}
                </button>
              </div>
            ) : (
              <>
                <TrackIconBtn tooltip="Replace track" onClick={() => fileRef.current?.click()}>
                  <ReplaceIcon />
                </TrackIconBtn>
                {!isMidi && (
                  <TrackIconBtn tooltip="Download as WAV" href={`/api/tracks/${track.id}/download`}>
                    <DownloadIcon />
                  </TrackIconBtn>
                )}
                <TrackIconBtn tooltip="Delete track" danger onClick={() => setConfirmDelete(true)}>
                  <TrashIcon />
                </TrackIconBtn>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Waveform column */}
      <div
        ref={waveformColRef}
        data-waveform-col
        className="relative flex-1 min-w-0 overflow-hidden border-l border-border/0"
        style={{ minHeight: rowH, opacity: waveformOpacity, transition: 'opacity 0.15s' }}
      >
        {!commentMode && (
          <TactGrid
            totalBars={totalBars}
            barDurationMs={barDurationMsRow}
            totalDurationMs={timelineDurationMs}
            interactive={waveformsInteractive}
            onTactClick={bar => { void snapStartBar(bar) }}
          />
        )}
      </div>

      {/* Waveform clip — row-relative so pre-roll extends under the label column */}
      <div
        ref={waveformClipRef}
        style={{
          position: 'absolute',
          top: 0,
          left: clipLayout.left,
          width: clipLayout.width,
          height: '100%',
          minHeight: rowH,
          opacity: waveformOpacity,
          cursor: !waveformsInteractive ? 'default' : isOffsetDragging ? 'grabbing' : commentMode ? 'inherit' : 'grab',
          pointerEvents: waveformsInteractive ? 'auto' : 'none',
          borderLeft: effectiveStartBar !== 0 ? '1px solid var(--border)' : 'none',
          zIndex: 1,
          transition: isOffsetDragging ? 'none' : 'width 0.25s ease-out, opacity 0.15s',
          touchAction: commentMode ? 'auto' : 'none',
        }}
        onMouseDown={commentMode ? undefined : handleOffsetMouseDown}
        onTouchStart={commentMode ? undefined : handleOffsetTouchStart}
      >
          {isMidi ? (
            track.midi_data ? (
              <div className="relative w-full h-full">
                <MiniPianoRoll
                  midiData={track.midi_data}
                  color={accentColor}
                  projectBpm={project.bpm ?? undefined}
                  totalProjectMs={trackOwnDurationMs}
                  height={rowH}
                  midiStartBar={0}
                />
                {midiRendering && (
                  <div className="absolute inset-0 grid place-items-center bg-background/50 pointer-events-none">
                    <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Rendering audio…</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full grid place-items-center bg-surface-2">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Loading…</span>
              </div>
            )
          ) : (
            <Waveform
                trackId={track.id} color={accentColor}
                durationMs={trackOwnDurationMs} commentMode={commentMode}
                barCount={displayBarCount}
                comments={(track.comments ?? []).map(c => ({
                  ...c,
                  timecode_start_ms: c.timecode_start_ms - trackOffsetMs,
                  timecode_end_ms: c.timecode_end_ms - trackOffsetMs,
                }))}
                activeInput={activeInput} audioReady={audioReady}
                onCommentPlace={input => onCommentPlace({
                  ...input,
                  startMs: input.startMs + trackOffsetMs,
                  endMs: input.endMs + trackOffsetMs,
                })}
                onCommentDelete={onCommentDelete}
                onCommentCreate={(tid, sMs, eMs, content) =>
                  onCommentCreate(tid, trackOffsetMs + sMs, trackOffsetMs + eMs, content)
                }
                onCloseInput={onCloseInput}
                onReady={(decodedMs) => {
                  setWaveformReady(true)
                  if (decodedMs) onTrackDuration?.(track.id, decodedMs)
                }}
                currentUserId={currentUserId} isOwner={isOwner} onReplyCreate={onReplyCreate}
                currentUser={currentUser}
                onCommentInteractionChange={handleCommentInteractionChange}
                compact={compact}
                interactionsEnabled={waveformsInteractive}
              />
          )}
      </div>

      {isOffsetDragging && (
        <>
          <div
            ref={snapIndicatorRef}
            className="absolute top-0 h-full pointer-events-none z-20"
            style={{ left: clipLayout.left, width: 0, minHeight: rowH }}
          >
            <div className="absolute top-0 bottom-0 w-px bg-lime" />
          </div>
          <span
            ref={snapBarLabelRef}
            className="absolute top-1 z-20 pointer-events-none text-[9px] font-mono tabular-nums whitespace-nowrap rounded px-1 py-px bg-lime text-primary-foreground"
            style={{ lineHeight: '1.3' }}
          />
        </>
      )}

      <input ref={fileRef} type="file"
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = '' }}
      />
    </div>

    {/* Piano roll editor — inline expandable panel, above tact grid overlay */}
    <div style={{
      maxHeight: pianoRollOpen ? 500 : 0,
      overflow: 'hidden',
      transition: 'max-height 0.3s ease',
      position: pianoRollOpen ? 'relative' : undefined,
      zIndex: pianoRollOpen ? 2 : undefined,
    }}>
      {pianoRollOpen && (
        <PianoRollEditor
          track={track}
          projectId={projectId}
          versionId={versionId}
          bpm={project.bpm ?? 120}
          timeSignatureNumerator={
            project.time_signature ? parseInt(project.time_signature.split('/')[0]) : 4
          }
          timeSignatureDenominator={
            project.time_signature ? parseInt(project.time_signature.split('/')[1]) : 4
          }
          midiStartBar={track.start_bar ?? track.midi_start_bar ?? 0}
          isRenderingMidi={!!midiRendering}
          onClose={() => setPianoRollOpen(false)}
          onSaved={async (updates) => {
            onMidiDataUpdate(track.id, updates)
            await waitForMidiRender(track.id)
            setPianoRollOpen(false)
          }}
        />
      )}
    </div>
    </>
  )
})

// ─── Upload progress row ──────────────────────────────────────────────────────

function UploadRow({ upload, onRetry, onDismiss }: {
  upload: UploadItem
  onRetry: () => void
  onDismiss: () => void
}) {
  const { file, status, progress, error } = upload
  const name = file.name.replace(/\.[^.]+$/, '')
  const isMidi = file.name.endsWith('.mid') || file.name.endsWith('.midi')

  // Subtitle line shown under the track name
  let subtitle: React.ReactNode = null
  if (status === 'pending') {
    subtitle = <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Waiting…</span>
  } else if (status === 'presigning') {
    subtitle = <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Preparing upload…</span>
  } else if (status === 'uploading') {
    const loaded = Math.round(file.size * progress / 100)
    subtitle = (
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {formatBytes(loaded)} / {formatBytes(file.size)}
      </span>
    )
  } else if (status === 'processing') {
    subtitle = (
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {isMidi ? 'Parsing MIDI…' : 'Converting to FLAC…'}
      </span>
    )
  } else if (status === 'done') {
    subtitle = <span style={{ fontSize: 11, color: '#22c55e' }}>✓ Done</span>
  } else if (status === 'error') {
    subtitle = <span style={{ fontSize: 11, color: '#ef4444' }}>{error || 'Upload failed'}</span>
  }

  // Waveform-area progress bar (1fr column)
  let waveformArea: React.ReactNode = null
  if (status === 'uploading') {
    waveformArea = (
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`, height: '100%',
          background: 'var(--accent)', borderRadius: 3,
          transition: 'width 0.2s ease',
        }} />
      </div>
    )
  } else if (status === 'processing') {
    // Bar is 100% filled (upload done); shimmer overlay indicates ongoing work
    waveformArea = (
      <div style={{ height: 6, borderRadius: 3, background: 'var(--accent)', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.2s infinite linear',
        }} />
      </div>
    )
  } else if (status === 'pending' || status === 'presigning') {
    waveformArea = (
      <div className="animate-pulse" style={{ height: 6, borderRadius: 3, background: 'var(--border)' }} />
    )
  }

  return (
    <div
      className="flex border-b border-border"
      style={{ minHeight: TRACK_ROW_H, borderLeft: status === 'error' ? '3px solid var(--destructive)' : undefined }}
    >
      <div className="shrink-0 border-r border-border p-3 flex flex-col justify-center" style={{ width: TRACK_LABEL_W }}>
        <div className="text-xs font-bold uppercase tracking-tight truncate text-muted-foreground">{name}</div>
        <div className="mt-0.5">{subtitle}</div>
      </div>
      <div className="flex-1 flex items-center px-3 min-w-0">
        <div className="flex-1 min-w-0">
          {waveformArea}
        </div>
        {status === 'uploading' && (
          <span className="text-[9px] tabular-nums text-muted-foreground ml-2 shrink-0">{progress}%</span>
        )}
      </div>
      <div className="shrink-0 border-l border-border flex items-center px-2">
        {status === 'error' && (
          <div className="flex items-center gap-1">
            <ActionButton label="R" tooltip="Retry upload" onClick={onRetry} />
            <ActionButton label="C" tooltip="Dismiss" onClick={onDismiss} />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Master player (bottom bar) ───────────────────────────────────────────────

const TransportToggle = memo(function TransportToggle({
  label, active, onClick, tooltip, disabled = false,
}: { label: string; active: boolean; onClick: () => void; tooltip: string; disabled?: boolean }) {
  return (
    <HoverTooltip label={tooltip} className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        className={`h-7 px-2 border text-[9px] font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active
            ? 'border-lime bg-lime text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
        }`}
      >
        {label}
      </button>
    </HoverTooltip>
  )
})

function MasterPlayerBar({
  playing, currentTime, currentTimeRef, duration, loaded, total, volume,
  onPlay, onPause, onSeek, onVolume,
  metronomeOn, countdownOn, isCounting,
  onToggleMetronome, onToggleCountdown,
  sectionLoopOn, sectionLoopEnabled, onToggleSectionLoop,
  compact = false,
}: {
  playing: boolean; currentTime: number
  /** Updated every rAF — used to drive the progress bar DOM directly. */
  currentTimeRef: React.RefObject<number>
  duration: number; loaded: number; total: number; volume: number
  onPlay: () => void; onPause: () => void; onSeek: (t: number) => void; onVolume: (v: number) => void
  metronomeOn: boolean; countdownOn: boolean; isCounting: boolean
  onToggleMetronome: () => void; onToggleCountdown: () => void
  sectionLoopOn: boolean; sectionLoopEnabled: boolean; onToggleSectionLoop: () => void
  compact?: boolean
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const fillRefC = useRef<HTMLDivElement>(null)   // compact version
  const cursorRef = useRef<HTMLDivElement>(null)
  const cursorRefC = useRef<HTMLDivElement>(null) // compact version
  const draggingRef = useRef(false)
  const seekPreviewRef = useRef<number | null>(null)
  const durationRef = useRef(duration)
  durationRef.current = duration
  const isLoading = loaded < total && total > 0

  // Drive progress bar fill + cursor via rAF — no React state per frame.
  useEffect(() => {
    let raf: number
    function update() {
      const ct = seekPreviewRef.current ?? currentTimeRef.current ?? 0
      const dur = durationRef.current
      const pct = dur > 0 ? Math.min(1, ct / dur) * 100 : 0
      const w = `${pct}%`
      if (fillRef.current)   fillRef.current.style.width   = w
      if (fillRefC.current)  fillRefC.current.style.width  = w
      if (cursorRef.current) cursorRef.current.style.left  = w
      if (cursorRefC.current) cursorRefC.current.style.left = w
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  // Intentionally stable — reads refs, not state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clientXToPct(clientX: number) {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  function startDrag(clientX: number) {
    if (isLoading) return
    draggingRef.current = true
    seekPreviewRef.current = clientXToPct(clientX) * durationRef.current
  }
  function moveDrag(clientX: number) {
    if (!draggingRef.current) return
    seekPreviewRef.current = clientXToPct(clientX) * durationRef.current
  }
  function commitDrag() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const t = seekPreviewRef.current
    seekPreviewRef.current = null
    if (t !== null) onSeek(t)
  }

  const transportToggles = (
    <div className="flex items-center gap-1.5 shrink-0">
      <TransportToggle
        label="Metro"
        active={metronomeOn}
        onClick={onToggleMetronome}
        tooltip="Metronome click track"
      />
      <TransportToggle
        label="Count-in"
        active={countdownOn}
        onClick={onToggleCountdown}
        tooltip="One-bar count-in before play"
      />
      <TransportToggle
        label="Loop"
        active={sectionLoopOn}
        onClick={onToggleSectionLoop}
        tooltip={sectionLoopOn ? 'Stop looping this section' : 'Loops structure sections only'}
        disabled={!sectionLoopEnabled}
      />
      {isCounting && (
        <span className="text-[9px] uppercase tracking-widest text-amber shrink-0">Count-in…</span>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="border-t border-border bg-surface/60 px-3 flex items-center gap-2 shrink-0 h-10">
        {transportToggles}
        <button
          type="button"
          onClick={(playing || isCounting) ? onPause : onPlay}
          disabled={duration <= 0 || isLoading}
          className="size-10 bg-lime text-primary-foreground grid place-items-center active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          aria-label={(playing || isCounting) ? 'Pause' : 'Play'}
        >
          {isLoading ? (
            <Spinner size={14} tone="white" />
          ) : (
            <span className="text-sm translate-x-px">{(playing || isCounting) ? '❚❚' : '▶'}</span>
          )}
        </button>
        <div
          ref={barRef}
          className={`flex-1 min-w-0 h-1 bg-surface-2 relative select-none ${isLoading ? 'cursor-default pointer-events-none' : 'cursor-pointer'}`}
          onMouseDown={e => startDrag(e.clientX)}
          onMouseMove={e => moveDrag(e.clientX)}
          onMouseUp={commitDrag}
          onMouseLeave={commitDrag}
          onTouchStart={e => startDrag(e.touches[0].clientX)}
          onTouchMove={e => moveDrag(e.touches[0].clientX)}
          onTouchEnd={commitDrag}
        >
          <div ref={fillRefC} className="absolute inset-y-0 left-0 bg-lime" style={{ width: '0%' }} />
          <div ref={cursorRefC} className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: '0%' }} />
        </div>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0 w-[4.5rem] text-right">
          {fmtTime(currentTime)}
        </span>
      </div>
    )
  }

  return (
    <div className="border-t border-border bg-surface/60 px-4 sm:px-6 py-3 hidden landscape:flex sm:flex items-center gap-3 sm:gap-6 flex-wrap shrink-0">
      <div className="flex items-center gap-3">
        {transportToggles}
        <button
          type="button"
          onClick={(playing || isCounting) ? onPause : onPlay}
          disabled={duration <= 0 || isLoading}
          className="size-10 bg-lime text-primary-foreground grid place-items-center active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={(playing || isCounting) ? 'Pause' : 'Play'}
        >
          {isLoading ? (
            <Spinner size={14} tone="white" />
          ) : (
            <span className="text-sm translate-x-px">{(playing || isCounting) ? '❚❚' : '▶'}</span>
          )}
        </button>
        <div className="font-mono text-xs tabular-nums">
          <span className="text-foreground">{fmtTime(currentTime)}</span>
          <span className="text-muted-foreground"> / {fmtTime(duration)}</span>
        </div>
      </div>

      <div
        ref={barRef}
        className={`flex-1 min-w-[200px] h-2 bg-surface-2 relative select-none ${isLoading ? 'cursor-default pointer-events-none' : 'cursor-pointer'}`}
        onMouseDown={e => startDrag(e.clientX)}
        onMouseMove={e => moveDrag(e.clientX)}
        onMouseUp={commitDrag}
        onMouseLeave={commitDrag}
      >
        <div ref={fillRef} className="absolute inset-y-0 left-0 bg-lime" style={{ width: '0%' }} />
        <div ref={cursorRef} className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: '0%' }} />
      </div>

      <div className="flex items-center gap-3">
        <SectionLabel>VOL</SectionLabel>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={e => onVolume(parseFloat(e.target.value))}
          className="w-24 accent-lime"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums w-8">{Math.round(volume * 100)}</span>
      </div>
    </div>
  )
}

// ─── Version tag helpers ──────────────────────────────────────────────────────

interface TagStyle { label: string; bg: string; darkBg: string }

const PREDEFINED_TAGS: Record<string, TagStyle> = {
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
const CUSTOM_TAG_COLORS = { bg: '#D97706', darkBg: '#F59E0B' }

/** Returns label + background color for a tag, or null if no tag. */
function versionTagStyle(
  tag: string | null | undefined,
  dark: boolean,
): { label: string; bg: string } | null {
  if (!tag) return null
  const preset = PREDEFINED_TAGS[tag]
  if (preset) return { label: preset.label, bg: dark ? preset.darkBg : preset.bg }
  return { label: tag, bg: dark ? CUSTOM_TAG_COLORS.darkBg : CUSTOM_TAG_COLORS.bg }
}

/** Backward-compat label-only helper (used in tag chip selector display). */
function versionTagLabel(tag: string | null | undefined): string | null {
  if (!tag) return null
  return PREDEFINED_TAGS[tag]?.label ?? tag
}

// ─── Format bytes helper ──────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ versions, activeId, onSelect, onNewBranch, onMerge, storageUsed, storageLimit, storageFull, commentCounts, projectId, projectName, isOpen, compact = false, isDark = false, resourceFilterTrackId = null, resourceFilterTrackName = null, onClearResourceFilter, onNavigateResourceVersion, onNavigateResourceTrack }: {
  versions: Version[]; activeId: string
  onSelect: (id: string) => void; onNewBranch: () => void; onMerge: (id: string) => void
  storageUsed: number
  storageLimit: number
  storageFull: boolean
  commentCounts: Record<string, number>
  projectId: string
  projectName: string
  isOpen?: boolean
  compact?: boolean
  isDark?: boolean
  resourceFilterTrackId?: string | null
  resourceFilterTrackName?: string | null
  onClearResourceFilter?: () => void
  onNavigateResourceVersion?: (versionId: string) => void
  onNavigateResourceTrack?: (trackId: string, versionId: string) => void
}) {
  const [hideMerged, setHideMerged] = useState(false)
  const main = versions.find(v => v.type === 'main')
  const branches = versions.filter(v => v.type === 'branch')
  const listedVersions = [main, ...branches].filter(Boolean).filter(
    v => !hideMerged || !v!.merged_at || v!.id === activeId,
  )
  const active = versions.find(v => v.id === activeId)
  const canMerge = active?.type === 'branch' && !active.merged_at

  const staticActions: { label: string; icon: React.ReactNode; action: () => void }[] = [
    {
      label: '+ New version',
      icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" /><path d="M3 4.5V7.5M3 4.5C3 7 6 7 6 9H7.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>,
      action: onNewBranch,
    },
  ]

  const isChecking = false
  const storagePct = Math.min(100, (storageUsed / storageLimit) * 100)

  const { open: resourcesOpen, toggle: toggleResourcesOpen } = useResourcesSidebarOpen()

  return (
    <aside
      data-tour="versions-sidebar"
      className={`project-mixer-sidebar w-[200px] shrink-0 flex flex-col h-full overflow-hidden border-r border-border ${
        compact ? 'bg-surface' : 'bg-surface/30'
      }${isOpen ? ' sidebar-open' : ''}`}
    >
      {/* ── Version history: flex half, scrolls internally, grows when Resources collapses ── */}
      <div className="flex flex-col border-b border-border min-h-0" style={{ flex: '1 1 0' }}>
        {/* Fixed header */}
        <div className={compact ? 'px-3 pt-3 pb-1 shrink-0' : 'px-4 pt-4 pb-1 shrink-0'}>
          <SectionLabel>VERSION HISTORY</SectionLabel>
          <button
            type="button"
            role="checkbox"
            aria-checked={hideMerged}
            onClick={() => setHideMerged(v => !v)}
            className="flex items-center gap-2 mt-1.5 cursor-pointer select-none bg-transparent border-0 p-0 text-left"
          >
            <span
              className={`size-2 shrink-0 rounded-none border transition-colors ${
                hideMerged ? 'bg-lime border-lime' : 'bg-transparent border-border'
              }`}
              aria-hidden
            />
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Hide applied
            </span>
          </button>
        </div>

        {/* Scrollable version list */}
        <div className="overflow-y-auto scrollbar-none min-h-0 flex-1">
          <div className={compact ? 'px-1 pb-1 space-y-px' : 'px-2 pb-2 space-y-px'}>
            {listedVersions.map(v => {
              const isActive = v!.id === activeId
              const comments = commentCounts[v!.id] ?? 0
              const tagStyle = versionTagStyle(v!.tag, isDark)
              return (
                <button
                  key={v!.id}
                  type="button"
                  onClick={() => onSelect(v!.id)}
                  className={`group w-full text-left flex items-center gap-2 px-1.5 py-0.5 transition-colors ${
                    isActive ? 'bg-lime/10' : 'hover:bg-surface-2'
                  }`}
                >
                  {/* Square indicator */}
                  <span
                    className="shrink-0 inline-block"
                    style={{
                      width: 8, height: 8, borderRadius: 1,
                      background: isActive
                        ? 'var(--lime)'
                        : v!.merged_at
                          ? 'var(--color-online)'
                          : 'var(--border)',
                    }}
                  />
                  {/* Version name + sub-info */}
                  <span className="flex-1 min-w-0">
                    {compact ? (
                      <span className="block text-[10px] font-bold text-foreground truncate leading-tight">{v!.name}</span>
                    ) : (
                      <>
                        <span className="block text-[11px] font-bold text-foreground truncate">{v!.name}</span>
                        <span className="block text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5 truncate">
                          {fmtDate(v!.created_at)}{comments > 0 ? ` · ${comments} CMT` : ''}
                        </span>
                      </>
                    )}
                  </span>
                  {/* Tag pill — desktop only, not on Master */}
                  {!compact && tagStyle && v!.type !== 'main' && (
                    <span
                      className="shrink-0 hidden sm:block font-bold tracking-widest whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        fontSize: 9,
                        padding: '2px 5px',
                        background: tagStyle.bg,
                        color: '#fff',
                        maxWidth: 80,
                        borderRadius: 0,
                      }}
                    >
                      {tagStyle.label}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Fixed footer: apply + new version — always visible */}
        <div className={`shrink-0 border-t border-border ${compact ? 'p-2' : 'px-3 py-2'} space-y-1`}>
          {canMerge && (
            <button
              type="button"
              onClick={() => !isChecking && onMerge(activeId)}
              disabled={isChecking}
              className="w-full text-left border border-lime/50 text-lime bg-lime-soft py-2 px-3 uppercase tracking-widest text-[10px] hover:bg-lime/20 transition disabled:opacity-50"
            >
              {isChecking ? 'Checking…' : 'Apply version →'}
            </button>
          )}
          {staticActions.map(({ label, icon, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              data-tour="new-branch-button"
              className="w-full text-left border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime transition flex items-center gap-2"
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Resources: collapsible, fills remaining space ── */}
      {!compact && (
        <div
          className="flex flex-col min-h-0 overflow-hidden border-b border-border"
          style={{ flex: resourcesOpen ? '1 1 0' : '0 0 auto' }}
        >
          <div className={`px-2 pt-2${resourcesOpen ? ' pb-2 flex-1 overflow-y-auto scrollbar-none min-h-0' : ' pb-0 overflow-hidden'}`}>
            <ResourcesCard
              projectId={projectId}
              projectName={projectName}
              bare
              variant="sidebar"
              hideLyrics
              storageFull={storageFull}
              filterTrackId={resourceFilterTrackId}
              filterTrackName={resourceFilterTrackName}
              onClearFilter={onClearResourceFilter}
              versions={versions}
              onNavigateVersion={onNavigateResourceVersion}
              onNavigateTrack={onNavigateResourceTrack}
              collapsed={!resourcesOpen}
              onToggleCollapse={toggleResourcesOpen}
            />
          </div>
        </div>
      )}

      <div className={`shrink-0 border-t border-border ${compact ? 'p-3' : 'px-4 py-2'}`}>
        <SectionLabel>STORAGE · {formatStorageLimit(storageLimit)}</SectionLabel>
        {compact ? (
          <div className="text-[10px] tabular-nums mt-1 text-muted-foreground truncate">
            {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
            <span className={`ml-2 ${storageFull ? 'text-destructive' : storagePct > 95 ? 'text-destructive' : 'text-lime'}`}>
              {Math.round(storagePct)}%
            </span>
          </div>
        ) : (
          <>
            <div className="text-[10px] tabular-nums mt-1 text-muted-foreground">
              {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
            </div>
            <div className="h-1 bg-surface-2 mt-1 overflow-hidden">
              <div
                className={`h-full transition-all ${storageFull || storagePct > 95 ? 'bg-destructive' : 'bg-lime'}`}
                style={{ width: `${storagePct}%` }}
              />
            </div>
            {storageFull ? (
              <p className="text-[9px] text-destructive mt-1 m-0">Storage full — delete tracks or files to upload more</p>
            ) : storageUsed / storageLimit > 0.95 ? (
              <p className="text-[9px] text-destructive mt-1 m-0">Almost full</p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}

// ─── New branch modal ─────────────────────────────────────────────────────────

const NEW_VERSION_TAG_OPTIONS = [
  { value: 'experiment',  label: 'EXPERIMENT',  hint: 'Trying a new idea'        },
  { value: 'fix',         label: 'FIX',         hint: 'Re-recording / correcting' },
  { value: 'arrangement', label: 'ARRANGEMENT', hint: 'Changing song structure'  },
  { value: 'mix',         label: 'MIX',         hint: 'Levels, balance, processing' },
  { value: 'feature',     label: 'FEATURE',     hint: 'Adding something new'     },
  { value: 'custom',      label: 'CUSTOM',      hint: 'Enter your own label'     },
] as const

function NewBranchModal({ onConfirm, onCancel }: { onConfirm: (n: string, tag: string | null) => void; onCancel: () => void }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const [step, setStep] = useState<'name' | 'tag'>('name')
  const [name, setName] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [customTag, setCustomTag] = useState('')

  function advanceToTag() {
    if (!name.trim()) return
    setStep('tag')
  }

  function handleCreate(skipTag = false) {
    if (!name.trim()) return
    let tag: string | null = null
    if (!skipTag && selectedTag) {
      tag = selectedTag === 'custom' ? (customTag.trim().slice(0, 20) || null) : selectedTag
    }
    onConfirm(name.trim(), tag)
  }

  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
        {step === 'name' ? (
          <>
            <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">New version</p>
            <input
              autoFocus value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) advanceToTag(); if (e.key === 'Escape') onCancel() }}
              placeholder="feature/new-guitar"
              className="w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-lime placeholder:text-muted-foreground/60 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <TbBtn onClick={onCancel}>Cancel</TbBtn>
              <TbBtn variant="primary" onClick={advanceToTag} disabled={!name.trim()}>Next →</TbBtn>
            </div>
          </>
        ) : (
          <>
            <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">{name}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 mb-4">What&apos;s this version for? <span className="normal-case tracking-normal">(optional)</span></p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {NEW_VERSION_TAG_OPTIONS.map(opt => {
                const ts = opt.value === 'custom'
                  ? { label: 'CUSTOM', bg: isDark ? CUSTOM_TAG_COLORS.darkBg : CUSTOM_TAG_COLORS.bg }
                  : versionTagStyle(opt.value, isDark)
                const isSelected = selectedTag === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedTag(s => s === opt.value ? null : opt.value)}
                    className={`text-left px-3 py-2 border text-[10px] uppercase tracking-widest transition ${
                      isSelected
                        ? 'border-transparent'
                        : 'border-border text-muted-foreground hover:border-foreground/40'
                    }`}
                    style={isSelected ? { background: ts?.bg, color: '#fff', borderColor: 'transparent' } : {}}
                  >
                    <span className="flex items-center gap-2">
                      {!isSelected && (
                        <span className="shrink-0 inline-block" style={{ width: 8, height: 8, borderRadius: 0, background: ts?.bg }} />
                      )}
                      <span className="font-bold">{opt.label}</span>
                    </span>
                    <span className={`block normal-case tracking-normal text-[9px] mt-0.5 ${isSelected ? 'opacity-80' : 'opacity-60'}`}>{opt.hint}</span>
                  </button>
                )
              })}
            </div>
            {selectedTag === 'custom' && (
              <input
                autoFocus
                value={customTag}
                onChange={e => setCustomTag(e.target.value.slice(0, 20))}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setSelectedTag(null) }}
                placeholder="e.g. vocals-rewrite"
                maxLength={20}
                className="w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-lime placeholder:text-muted-foreground/60 mb-4"
              />
            )}
            <div className="flex gap-2 justify-between">
              <TbBtn onClick={() => setStep('name')}>← Back</TbBtn>
              <div className="flex gap-2">
                <TbBtn onClick={() => handleCreate(true)}>Skip</TbBtn>
                <TbBtn variant="primary" onClick={() => handleCreate()}>Create</TbBtn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Project page skeleton ────────────────────────────────────────────────────

function TrackRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
      <Skeleton width={32} height={32} className="shrink-0" />
      <div className="flex flex-col gap-1 w-28 shrink-0">
        <Skeleton width="80%" height={12} />
        <Skeleton width="55%" height={10} />
      </div>
      {/* Waveform area */}
      <Skeleton width="100%" height={48} className="flex-1" />
    </div>
  )
}

// ── Mobile portrait skeleton ──────────────────────────────────────────────────

function MobilePortraitSkeleton() {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      {/* Slim top bar — matches MobileExperience header */}
      <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="font-display text-sm font-bold tracking-tight text-lime shrink-0">TRACKBASE</span>
          <nav className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-w-0 overflow-hidden">
            <span className="shrink-0">Bands</span>
            <span className="text-border shrink-0">/</span>
            <Skeleton width={60} height={10} className="shrink-0" />
            <span className="text-border shrink-0">/</span>
            <Skeleton width={80} height={10} />
          </nav>
        </div>
        {/* Avatar placeholder */}
        <Skeleton width={28} height={28} borderRadius="50%" className="shrink-0" />
      </header>

      {/* Mode switch bar — matches MobileExperience mode tabs */}
      <div className="px-3 pt-3 pb-2 border-b border-border bg-surface/40 shrink-0 space-y-2">
        <div className="grid grid-cols-2 border border-border bg-background">
          <div className="py-2.5 bg-lime text-primary-foreground text-[10px] font-bold uppercase tracking-widest flex items-center justify-center">
            ● Rehearsal
          </div>
          <div className="py-2.5 text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center justify-center">
            ≡ Mixer
          </div>
        </div>
      </div>

      {/* Rehearsal content skeleton */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Project header */}
        <div className="px-5 py-4 border-b border-border">
          <Skeleton width={100} height={10} className="mb-2" />
          <Skeleton width={220} height={30} className="mb-2" />
          <div className="flex gap-3">
            <Skeleton width={56} height={10} />
            <Skeleton width={36} height={10} />
            <Skeleton width={44} height={10} />
          </div>
        </div>

        {/* Waveform / progress bar */}
        <div className="px-5 py-4 border-b border-border">
          <Skeleton width="100%" height={56} className="mb-2" />
          <div className="flex justify-between">
            <Skeleton width={30} height={9} />
            <Skeleton width={30} height={9} />
          </div>
        </div>

        {/* Section cards */}
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="px-5 py-3 border-b border-border flex flex-col gap-2">
            <Skeleton width={80} height={10} />
            <div className="flex flex-wrap gap-2">
              {[40, 50, 45, 40].map((w, j) => (
                <Skeleton key={j} width={w} height={28} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Fixed player at bottom */}
      <div className="border-t border-border bg-surface/60 px-4 py-3 shrink-0 flex items-center gap-4">
        <Skeleton width={40} height={40} />
        <Skeleton width="100%" height={6} className="flex-1" />
        <Skeleton width={48} height={12} />
      </div>
    </div>
  )
}

// ── Mobile landscape skeleton ─────────────────────────────────────────────────

function MobileLandscapeSkeleton() {
  return (
    <div className="project-page flex flex-col h-screen overflow-hidden bg-background">
      {/* Compact header bar */}
      <div className="flex items-center justify-between h-10 px-3 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-2">
          <Skeleton width={60} height={10} />
          <span className="text-border text-[10px]">/</span>
          <Skeleton width={100} height={12} />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton width={56} height={22} />
          <Skeleton width={56} height={22} />
        </div>
      </div>

      {/* Version tab bar */}
      <div className="border-b border-border bg-surface/20 shrink-0 px-2 flex items-center gap-1 h-8">
        {[48, 40, 40, 52, 44].map((w, i) => (
          <Skeleton key={i} width={w} height={20} />
        ))}
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-2 px-3 py-1 border-b border-border">
            <Skeleton width={24} height={24} className="shrink-0" />
            <div className="flex flex-col gap-0.5 w-20 shrink-0">
              <Skeleton width="80%" height={10} />
              <Skeleton width="55%" height={8} />
            </div>
            <Skeleton width="100%" height={32} className="flex-1" />
          </div>
        ))}
      </div>

      {/* Compact transport */}
      <div className="border-t border-border bg-surface/60 px-3 flex items-center gap-2 shrink-0 h-10">
        <Skeleton width={38} height={16} />
        <Skeleton width={52} height={16} />
        <Skeleton width={36} height={32} />
        <Skeleton width="100%" height={6} className="flex-1" />
        <Skeleton width={44} height={10} />
      </div>
    </div>
  )
}

// ── Desktop skeleton ──────────────────────────────────────────────────────────

function DesktopPageSkeleton() {
  return (
    <div className="project-page flex flex-col h-screen overflow-hidden bg-background">
      {/* Real AppHeader — chrome is identical to the loaded page */}
      <AppHeader
        crumbs={
          <>
            <Skeleton width={72} height={12} className="inline-block align-middle" />
            <span className="text-border">/</span>
            <Skeleton width={120} height={14} className="inline-block align-middle" />
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Skeleton width={72} height={28} />
            <Skeleton width={72} height={28} />
            <Skeleton width={72} height={28} />
          </div>
        }
      />

      {/* Body — mirrors the real flex layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Version sidebar — matches project-mixer-sidebar w-[200px] */}
        <aside className="w-[200px] shrink-0 flex flex-col h-full overflow-hidden border-r border-border bg-surface/30">
          {/* Version history section */}
          <div className="flex flex-col border-b border-border min-h-0" style={{ flex: '1 1 0' }}>
            <div className="px-4 pt-4 pb-1 shrink-0">
              <SectionLabel>VERSION HISTORY</SectionLabel>
            </div>
            <div className="overflow-y-auto scrollbar-none min-h-0 flex-1 px-2 pb-2 space-y-px">
              {[80, 65, 90, 55, 75, 60, 45].map((w, i) => (
                <div key={i} className="flex items-center gap-2 px-1.5 py-1">
                  <span className="shrink-0 inline-block w-2 h-2 bg-border" style={{ borderRadius: 1 }} />
                  <div className="flex-1 min-w-0">
                    <Skeleton width={`${w}%`} height={11} className="mb-0.5" />
                    <Skeleton width="50%" height={9} />
                  </div>
                </div>
              ))}
            </div>
            {/* + NEW VERSION button */}
            <div className="shrink-0 border-t border-border px-3 py-2 space-y-1">
              <button
                disabled
                className="w-full text-left border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2 opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" />
                  <circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" />
                  <circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" />
                  <path d="M3 4.5V7.5M3 4.5C3 7 6 7 6 9H7.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
                </svg>
                + New version
              </button>
            </div>
          </div>

          {/* Resources section */}
          <div className="shrink-0 border-b border-border px-2 pt-2 pb-2">
            <div className="px-1 mb-2"><SectionLabel>RESOURCES</SectionLabel></div>
            <Skeleton width="100%" height={14} />
          </div>

          {/* Storage */}
          <div className="shrink-0 px-4 py-2">
            <SectionLabel>STORAGE</SectionLabel>
            <Skeleton width="65%" height={9} className="mt-1 mb-1" />
            <div className="h-1 bg-surface-2 overflow-hidden mt-1">
              <div className="h-full bg-lime/30" style={{ width: '40%' }} />
            </div>
          </div>
        </aside>

        {/* Main area */}
        <main className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background">
          {/* Project name / meta header */}
          <section className="border-b border-border bg-surface/40 shrink-0">
            <div className="px-4 sm:px-6 py-3 flex flex-col gap-2">
              <Skeleton width={260} height={28} />
              <div className="flex items-center gap-3">
                <Skeleton width={64} height={12} />
                <Skeleton width={36} height={12} />
                <Skeleton width={44} height={12} />
                <Skeleton width={72} height={12} />
                <Skeleton width={48} height={12} />
              </div>
            </div>
          </section>

          {/* Version tabs bar */}
          <div className="border-b border-border bg-surface/20 shrink-0 px-2 flex items-center gap-1 h-9 overflow-hidden">
            {[48, 40, 40, 52, 62, 40, 44].map((w, i) => (
              <Skeleton key={i} width={w} height={22} />
            ))}
          </div>

          {/* Timeline / structure bar */}
          <div className="h-10 border-b border-border bg-surface/40 shrink-0 px-4 flex items-center gap-3">
            <Skeleton width={52} height={14} />
            <Skeleton width={76} height={14} />
            <Skeleton width={52} height={14} />
            <Skeleton width={68} height={14} />
          </div>

          {/* Track list */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {[0, 1, 2, 3, 4].map(i => <TrackRowSkeleton key={i} />)}
          </div>

          {/* Transport bar — matches border-t border-border bg-surface/60 px-4 py-3 */}
          <div className="border-t border-border bg-surface/60 px-4 sm:px-6 py-3 hidden sm:flex items-center gap-3 sm:gap-6 shrink-0">
            <div className="flex items-center gap-3">
              {/* METRO, COUNT-IN, LOOP toggles */}
              <Skeleton width={42} height={18} />
              <Skeleton width={58} height={18} />
              <Skeleton width={38} height={18} />
              {/* Play button */}
              <Skeleton width={40} height={40} />
              {/* Time display */}
              <Skeleton width={68} height={13} />
            </div>
            {/* Timeline bar */}
            <Skeleton width="100%" height={8} className="flex-1 min-w-[200px]" />
            {/* Volume */}
            <div className="flex items-center gap-3">
              <Skeleton width={22} height={9} />
              <Skeleton width={96} height={8} />
              <Skeleton width={22} height={9} />
            </div>
          </div>

          {/* Status footer */}
          <div className="border-t border-border bg-surface/40 px-4 sm:px-6 py-1.5 hidden sm:flex items-center justify-between shrink-0">
            <Skeleton width={300} height={9} />
            <Skeleton width={130} height={9} />
          </div>
        </main>
      </div>
    </div>
  )
}

function ProjectPageSkeleton() {
  return (
    <>
      <div className="skeleton-portrait-mobile">
        <MobilePortraitSkeleton />
      </div>
      <div className="skeleton-landscape-mobile">
        <MobileLandscapeSkeleton />
      </div>
      <div className="skeleton-desktop">
        <DesktopPageSkeleton />
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { bandId, projectId } = useParams<{ bandId: string; projectId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const cache = useVersionCache()
  const { user, profile, updateOnboarding } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const { open: chatOpen, openChat, closeChat } = useChatPanel()
  const [chatUnread, setChatUnread] = useState(0)

  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const activeVersionIdRef = useRef('')
  activeVersionIdRef.current = activeVersionId
  const versionDeepLinkApplied = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'access_denied' | 'unknown' | null>(null)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [uploading, setUploading] = useState(false)  // for handleReplaceTrack only
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mobileReplaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTrackRef = useRef<Track | null>(null)
  const [commentMode, setCommentMode] = useState(false)
  const [resourceFilterTrackId, setResourceFilterTrackId] = useState<string | null>(null)
  const [activeCommentInput, setActiveCommentInput] = useState<ActiveCommentInput | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [mergeModal, setMergeModal] = useState<{ branchId: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(BAND_STORAGE_LIMIT_BYTES)
  const storageFull = storageUsed >= storageLimit
  const [shareCopied, setShareCopied] = useState(false)
  const [sections, setSections] = useState<Section[]>([])
  const [editStructure, setEditStructure] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [showMobileTour, setShowMobileTour] = useState(false)

  // ── Roadmap + checklist ──────────────────────────────────────────────────────
  const [planOpen, setPlanOpen] = useState(false)
  const { roadmap, setRoadmap } = useProjectRoadmap(projectId)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [checklistMembers, setChecklistMembers] = useState<ChecklistMember[]>([])
  const [waveformBounds, setWaveformBounds] = useState<{ left: number; right: number } | null>(null)
  // Responsive sidebar (collapsed by default on tablet/mobile)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )
  // Portrait detection — drives ReadingMode vs mixer (pure dimension check, no touch gate)
  const [isMobilePortrait, setIsMobilePortrait] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768 && window.innerHeight > window.innerWidth
  })
  // Short landscape: landscape + height < 420px + not a full desktop window
  const [isShortLandscape, setIsShortLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight && window.innerHeight < 420 && window.innerWidth < 1024
  })
  const [isMobileLandscape, setIsMobileLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight && window.innerWidth < 1024
  })
  const isDesktopMixer = !isMobilePortrait && !isMobileLandscape

  // Structure editing is desktop-only — keep mobile mixer light
  useEffect(() => {
    if (isMobileLandscape && editStructure) setEditStructure(false)
  }, [isMobileLandscape, editStructure])

  // Start streaming the cached preview mix as early as possible in rehearsal.
  useEffect(() => {
    if (!isMobilePortrait || !projectId) return
    prefetchPreviewMixPlayback(projectId)
  }, [isMobilePortrait, projectId])

  const [topbarSheetOpen, setTopbarSheetOpen] = useState(false)
  const trackListRef = useRef<HTMLDivElement>(null)
  const tracksBodyRef = useRef<HTMLDivElement>(null)
  const [recordingSessions, setRecordingSessions] = useState<{ id: string; name: string }[]>([])
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null)
  const [recordingPreviewEnds, setRecordingPreviewEnds] = useState<Record<string, number>>({})
  // Extra bars added during a live recording so the ruler doesn't stop at the
  // default 16-bar ceiling. Reset when the recording session ends.
  const [recordingExtraBars, setRecordingExtraBars] = useState(0)
  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingAddRow, setIsDraggingAddRow] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadsRef = useRef<UploadItem[]>([])
  // Track being dragged (for dimming others)
  const [decodedDurationMs, setDecodedDurationMs] = useState<Map<string, number>>(() => new Map())
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null)

  // ── Project rename ─────────────────────────────────────────────────────────
  const [projectNameEditing, setProjectNameEditing] = useState(false)
  const [projectNameValue, setProjectNameValue] = useState('')
  const [projectNameFlash, setProjectNameFlash] = useState(false)
  const projectNameInputRef = useRef<HTMLInputElement>(null)

  function startProjectRename() {
    if (!project) return
    setProjectNameValue(project.name)
    setProjectNameEditing(true)
    setTimeout(() => { projectNameInputRef.current?.select() }, 0)
  }

  // ── Roadmap + checklist handlers ─────────────────────────────────────────────
  function handleRoadmapChange(next: typeof roadmap) {
    setRoadmap(next)
  }

  async function handleChecklistAdd(text: string, assigneeId: string | null) {
    const res = await fetch(`/api/projects/${projectId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, assignee_id: assigneeId }),
    })
    if (res.ok) {
      const { item } = await res.json()
      setChecklist(prev => [...prev, item])
      trackEvent('checklist_item_added')
    }
  }

  async function handleChecklistToggle(id: string) {
    const item = checklist.find(i => i.id === id)
    if (!item) return
    const newDone = !item.done
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, done: newDone, done_at: newDone ? new Date().toISOString() : null } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: newDone }),
    }).catch(() => {})
    if (newDone) trackEvent('checklist_item_completed')
  }

  async function handleChecklistUpdate(id: string, text: string) {
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, text } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {})
  }

  async function handleChecklistDelete(id: string) {
    setChecklist(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  async function handleChecklistAssign(id: string, assigneeId: string | null) {
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, assignee_id: assigneeId } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id: assigneeId }),
    }).catch(() => {})
  }

  async function commitProjectRename() {
    if (!project) return
    const trimmed = projectNameValue.trim()
    setProjectNameEditing(false)
    if (!trimmed || trimmed === project.name) return
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const { project: updated } = await res.json()
        setProject(updated)
        setProjectNameFlash(true)
        setTimeout(() => setProjectNameFlash(false), 400)
      }
    } catch { /* ignore */ }
  }

  async function loadProject(keepActiveVersion = true, force = false) {
    try {
      // Cache hit: if the active version is already cached, skip the full re-fetch
      if (!force && keepActiveVersion && activeVersionIdRef.current && cache.getVersion(activeVersionIdRef.current)) {
        console.log('[cache] hit on loadProject, skipping fetch for:', activeVersionIdRef.current)
        return
      }

      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        if (res.status === 403 || body?.code === 'ACCESS_DENIED') {
          setError('access_denied')
        } else if (res.status === 404 || body?.code === 'NOT_FOUND') {
          setError('not_found')
        } else {
          setError('unknown')
        }
        return
      }
      const data = await res.json()
      setProject(data.project)
      setVersions(data.versions)

      // Populate cache for all fetched versions
      for (const v of (data.versions as Version[])) {
        const comments: Record<string, TrackComment[]> = {}
        for (const t of v.tracks) {
          comments[t.id] = t.comments ?? []
        }
        cache.setVersion(v.id, { tracks: v.tracks, comments, fetchedAt: Date.now() })
      }

      const main = data.versions.find((v: Version) => v.type === 'main')
      const fallbackId = main?.id ?? data.versions[0]?.id ?? ''
      const selectedId = activeVersionIdRef.current

      if (!keepActiveVersion) {
        // Explicit reset (e.g. project change, post-merge).
        setActiveVersionId(fallbackId)
      } else if (!selectedId) {
        // First load with no selection yet.
        setActiveVersionId(fallbackId)
      } else if (!data.versions.some((v: Version) => v.id === selectedId)) {
        // Previously selected version was deleted.
        setActiveVersionId(fallbackId)
      }
      // else: keep the user's current branch selection

      fetch(`/api/projects/${projectId}/storage`)
        .then(r => r.json())
        .then(d => { setStorageUsed(d.used_bytes ?? 0); setStorageLimit(d.limit_bytes ?? BAND_STORAGE_LIMIT_BYTES) })
        .catch(() => {})
    } catch {
      setError('unknown')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProject(false) }, [projectId]) // eslint-disable-line

  useEffect(() => {
    versionDeepLinkApplied.current = false
  }, [projectId])

  const selectVersion = useCallback((id: string) => {
    if (id !== activeVersionIdRef.current) {
      trackEvent('version_switched')
    }
    setActiveVersionId(id)
    setCommentMode(false)
    setActiveCommentInput(null)
    setResourceFilterTrackId(null)
    if (searchParams.has('v') || searchParams.has('t') || searchParams.has('s') || searchParams.has('e')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('v')
      params.delete('t')
      params.delete('s')
      params.delete('e')
      const qs = params.toString()
      router.replace(`/band/${bandId}/project/${projectId}${qs ? `?${qs}` : ''}`, { scroll: false })
    }
  }, [bandId, projectId, router, searchParams])

  const navigateResourceVersion = useCallback((versionId: string) => {
    selectVersion(versionId)
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [selectVersion])

  const navigateResourceTrack = useCallback((trackId: string, versionId: string) => {
    setActiveVersionId(versionId)
    setCommentMode(false)
    setActiveCommentInput(null)
    setResourceFilterTrackId(trackId)
    requestAnimationFrame(() => {
      document.querySelector(`[data-track-row="${trackId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [])

  // Deep link from chat context chips: ?v=<versionId> — apply once on load only.
  useEffect(() => {
    if (versionDeepLinkApplied.current || versions.length === 0) return
    versionDeepLinkApplied.current = true
    const v = searchParams.get('v')
    if (v && versions.some(ver => ver.id === v)) {
      setActiveVersionId(v)
    }
  }, [versions, searchParams])

  // Load stage, checklist, and band members in parallel once projectId is known
  useEffect(() => {
    if (!projectId) return
    // Stage is included in the project response (loaded above); fetch checklist + members separately
    fetch(`/api/projects/${projectId}/checklist`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setChecklist(d.items ?? []) })
      .catch(() => {})
    fetch(`/api/bands/${bandId}/members`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.members) {
          setChecklistMembers(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (d.members as any[]).map((m: any) => ({
              user_id: m.user_id,
              username: m.profiles?.username ?? m.user_id,
              display_name: m.profiles?.display_name ?? null,
            }))
          )
        }
      })
      .catch(() => {})
  }, [projectId, bandId]) // eslint-disable-line

  // Sync stage from project once loaded — roadmap loads via useProjectRoadmap

  // Auto-start tour for first-time visitors — desktop mixer only
  useEffect(() => {
    if (!isDesktopMixer) return
    if (!loading && profile && !profile.onboarding?.project_tour_completed && !profile.onboarding?.project_tour_skipped) {
      const t = setTimeout(() => setShowTour(true), 400)
      return () => clearTimeout(t)
    }
  }, [loading, profile, isDesktopMixer])

  // Auto-start mobile tour — portrait rehearsal → mixer flow
  useEffect(() => {
    if (!isMobilePortrait) return
    if (!loading && profile && !profile.onboarding?.mobile_project_tour_completed && !profile.onboarding?.mobile_project_tour_skipped) {
      const t = setTimeout(() => setShowMobileTour(true), 600)
      return () => clearTimeout(t)
    }
  }, [loading, profile, isMobilePortrait])

  // On version switch: serve from cache if available, otherwise fetch fresh data.
  async function loadVersionData(versionId: string) {
    if (!versionId) return
    if (cache.getVersion(versionId)) {
      console.log('cache hit:', versionId)
      return
    }
    // Cache miss — full project refresh to get this version's tracks + comments
    setVersionLoading(true)
    try { await loadProject() }
    finally { setVersionLoading(false) }
  }

  useEffect(() => {
    if (activeVersionId) loadVersionData(activeVersionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersionId])

  useEffect(() => {
    if (!activeVersionId) return
    fetch(`/api/versions/${activeVersionId}/sections`)
      .then(r => r.json())
      .then(d => setSections(d.sections ?? []))
      .catch(() => {})
  }, [activeVersionId])

  const activeVersion = versions.find(v => v.id === activeVersionId)
  const activeTracks = activeVersion?.tracks ?? []
  const resourceFilterTrackName = useMemo(() => {
    if (!resourceFilterTrackId) return null
    const track = activeTracks.find(t => t.id === resourceFilterTrackId)
    return track ? (track.display_name ?? track.name) : null
  }, [resourceFilterTrackId, activeTracks])
  const midiTracksNeedingDataKey = useMemo(
    () => activeTracks
      .filter(t => t.file_type === 'midi' && !t.midi_data)
      .map(t => t.id)
      .sort()
      .join('|'),
    [activeTracks],
  )
  useEffect(() => {
    if (!midiTracksNeedingDataKey) return
    let cancelled = false
    for (const id of midiTracksNeedingDataKey.split('|')) {
      fetch(`/api/tracks/${id}/midi`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (cancelled || !data?.midi_data) return
          handleMidiDataUpdate(id, { midi_data: data.midi_data })
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [midiTracksNeedingDataKey])
  const canSaveVersion = activeVersion?.type === 'branch' && !activeVersion.merged_at

  // Assign vivid palette colors — backfill legacy defaults and dedupe batch-upload collisions.
  const backfillingColorsRef = useRef(false)
  const trackColorKey = activeTracks.map(t => `${t.id}:${t.icon_color ?? ''}`).join('|')
  useEffect(() => {
    if (!activeVersionId || !activeTracks.length || backfillingColorsRef.current) return

    const used = new Set<string>()
    const assignments: { id: string; color: string }[] = []

    activeTracks.forEach((t, i) => {
      let color = t.icon_color
      if (!color || needsTrackIconColor(color) || used.has(color)) {
        color = pickTrackIconColor(Array.from(used), i)
      }
      used.add(color)
      if (color !== t.icon_color) assignments.push({ id: t.id, color })
    })

    if (!assignments.length) return

    backfillingColorsRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const results = await Promise.allSettled(assignments.map(({ id, color }) =>
          fetch(`/api/tracks/${id}/icon`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon_color: color }),
          }).then(res => {
            if (!res.ok) throw new Error(`icon ${res.status}`)
          }),
        ))
        if (cancelled) return
        const byId = new Map<string, string>()
        assignments.forEach((a, i) => {
          if (results[i].status === 'fulfilled') byId.set(a.id, a.color)
        })
        if (byId.size === 0) return
        setVersions(prev => prev.map(v =>
          v.id !== activeVersionId ? v : {
            ...v,
            tracks: v.tracks.map(t => (
              byId.has(t.id) ? { ...t, icon_color: byId.get(t.id)! } : t
            )),
          },
        ))
      } catch {
        /* display fallbacks until next load */
      } finally {
        backfillingColorsRef.current = false
      }
    })()

    return () => { cancelled = true }
  }, [activeVersionId, trackColorKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Measure waveform column bounds for structure overlay alignment.
  // Uses [data-waveform-col] from an actual track row.
  useEffect(() => {
    if (isMobilePortrait) return
    const listEl = trackListRef.current
    if (!listEl) return
    function measure() {
      if (!listEl) return
      const wfEl = listEl.querySelector('[data-waveform-col]') as HTMLElement | null
      const rowEl = wfEl?.closest('[data-track-row]') as HTMLElement | null
      if (!wfEl || !rowEl) return
      const rowRect = rowEl.getBoundingClientRect()
      const wfRect = wfEl.getBoundingClientRect()
      setWaveformBounds({
        left: wfRect.left - rowRect.left,
        right: rowRect.right - wfRect.right,
      })
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(listEl)
    return () => obs.disconnect()
  }, [activeTracks.length, recordingSessions.length, isMobilePortrait])

  // Orientation detection — switches between ReadingMode and mixer, collapses topbar on short landscape
  useEffect(() => {
    if (typeof window === 'undefined') return
    function check() {
      const w = window.innerWidth, h = window.innerHeight
      setIsMobilePortrait(w < 768 && h > w)
      setIsShortLandscape(w > h && h < 420 && w < 1024)
      setIsMobileLandscape(w > h && w < 1024)
    }
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  const mainVersion = versions.find(v => v.type === 'main')
  const mainHashes = new Set((mainVersion?.tracks ?? []).map(t => t.file_hash))
  const isChanged = (t: Track) => !!mainVersion && activeVersionId !== mainVersion.id && !mainHashes.has(t.file_hash)

  const recordingPreviewEndSec = Math.max(0, ...Object.values(recordingPreviewEnds))

  const projBpm = project?.bpm ?? 120
  const projTimeSig = project?.time_signature ?? '4/4'
  const projBeatsPerBar = parseInt(projTimeSig.split('/')[0]) || 4
  const projBarDurationMs = (60000 / projBpm) * projBeatsPerBar
  const minTimelineBars = 16

  const baseProjectBars = (() => {
    if (activeTracks.length === 0) return minTimelineBars
    const barDurMs = projBarDurationMs || 2000
    const endBars = activeTracks.map(t => {
      const dMs = trackContentDurationMs(t, projBpm, decodedDurationMs.get(t.id))
      const bars = Math.ceil((dMs || 0) / barDurMs)
      return (t.start_bar ?? 0) + bars
    })
    return Math.max(...endBars, minTimelineBars)
  })()

  const totalProjectBars = Math.min(
    baseProjectBars + (activeRecordingId !== null ? recordingExtraBars : 0),
    MAX_PROJECT_BARS,
  )

  const timelineDurationSec = Math.max(
    (totalProjectBars * projBarDurationMs) / 1000,
    recordingPreviewEndSec,
    (minTimelineBars * projBarDurationMs) / 1000,
    1,
  )

  const player = usePlayer(
    activeTracks,
    activeVersionId,
    project,
    recordingPreviewEndSec,
    timelineDurationSec,
    {
      enabled: isMobilePortrait,
      projectId,
      isMainVersion: activeVersion?.type === 'main',
    },
  )
  const playerRef = useRef(player)
  playerRef.current = player

  const [activeLoopSectionId, setActiveLoopSectionId] = useState<string | null>(null)
  const sectionRanges = useMemo(() => buildSectionRanges(sections), [sections])
  const projBarDurationSec = projBarDurationMs / 1000
  const playheadSec = player.currentTimeRef.current ?? player.currentTime
  const canLoopSection = findSectionRangeAtTime(sectionRanges, playheadSec, projBarDurationSec) != null
  const sectionLoopButtonEnabled = player.sectionLoopOn || canLoopSection

  const handleToggleSectionLoop = useCallback(() => {
    const p = playerRef.current
    if (p.sectionLoopOn) {
      p.clearSectionLoop()
      setActiveLoopSectionId(null)
      trackEvent('loop_toggled', { enabled: false })
      return
    }
    const range = findSectionRangeAtTime(
      sectionRanges,
      p.currentTimeRef.current,
      projBarDurationSec,
    )
    if (!range) return
    p.setSectionLoop({ id: range.id, startBar: range.start_bar, endBar: range.end_bar })
    setActiveLoopSectionId(range.id)
    trackEvent('loop_toggled', { enabled: true })
  }, [sectionRanges, projBarDurationSec])

  useEffect(() => {
    if (!activeLoopSectionId) return
    const sec = sections.find(s => s.id === activeLoopSectionId)
    if (!sec) {
      playerRef.current.clearSectionLoop()
      setActiveLoopSectionId(null)
      return
    }
    playerRef.current.setSectionLoop({
      id: sec.id,
      startBar: sec.start_bar,
      endBar: sec.end_bar,
    })
  }, [sections, activeLoopSectionId])

  useEffect(() => {
    setActiveLoopSectionId(null)
    playerRef.current.clearSectionLoop()
  }, [activeVersionId])

  useEffect(() => {
    if (!player.sectionLoopOn) setActiveLoopSectionId(null)
  }, [player.sectionLoopOn])

  const activeRecordingIdRef = useRef(activeRecordingId)
  activeRecordingIdRef.current = activeRecordingId
  const recordingStopRef = useRef<(() => void) | null>(null)
  const recordingControlsRef = useRef<Map<string, RecordingTrackControl>>(new Map())
  const pendingMobileArmRef = useRef<string | null>(null)
  const pendingMicStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const [recordingRowStates, setRecordingRowStates] = useState<Record<string, RecordState>>({})
  const [scrollToRecordingId, setScrollToRecordingId] = useState<string | null>(null)

  const beginRecordingCountdown = useCallback(async (bpm: number, timeSig: string) => {
    const ctx = getSharedAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    return startCountdown(ctx, getMasterOutput(), bpm, timeSig)
  }, [])

  // Read from currentTimeRef (updated synchronously on every seek/tick) rather
  // than playerRef.current.currentTime (the 5Hz React state).  During
  // seek-while-playing, seek() sets currentTimeRef immediately but does NOT
  // call setCurrentTime(), so the React state is stale until the next rAF
  // tick.  Without this fix, RecordingTrackRow's preview effect fires (due to
  // seekEpoch) but reads the old position and re-schedules the source inside
  // the recording's range even when the user has seeked past it.
  const getRecordingPlaybackMs = useCallback(
    () => (playerRef.current.currentTimeRef.current ?? 0) * 1000,
    [],
  )

  useEffect(() => {
    setRecordingSessions([])
    setActiveRecordingId(null)
    setRecordingPreviewEnds({})
  }, [activeVersionId])

  function handleAddRecordingTrack() {
    if (storageFull) {
      setToast(storageQuotaError(storageUsed, storageLimit))
      setTimeout(() => setToast(null), 4000)
      return
    }
    if (!activeVersionId) return
    trackEvent('record_track_clicked')
    setRecordingSessions(prev => [...prev, { id: crypto.randomUUID(), name: 'New recording' }])
  }

  const registerRecordingControl = useCallback((id: string, control: RecordingTrackControl | null) => {
    if (control) {
      recordingControlsRef.current.set(id, control)
      if (pendingMobileArmRef.current === id) {
        pendingMobileArmRef.current = null
        const stream = pendingMicStreamsRef.current.get(id)
        if (stream) pendingMicStreamsRef.current.delete(id)
        void control.arm(stream)
      }
    } else {
      recordingControlsRef.current.delete(id)
    }
  }, [])

  const handleRecordingStateChange = useCallback((id: string, state: RecordState) => {
    setRecordingRowStates(prev => {
      if (prev[id] === state) return prev
      if (state === 'recording' && prev[id] !== 'recording') {
        trackEvent('recording_started')
      }
      return { ...prev, [id]: state }
    })
  }, [])

  const handleMobileRecordTransport = useCallback(async () => {
    if (recordingStopRef.current) {
      recordingStopRef.current()
      return
    }

    const targetId = activeRecordingId ?? recordingSessions[recordingSessions.length - 1]?.id

    if (!targetId) {
      const id = crypto.randomUUID()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        pendingMicStreamsRef.current.set(id, stream)
        pendingMobileArmRef.current = id
        setScrollToRecordingId(id)
        setRecordingSessions(prev => [...prev, { id, name: 'New recording' }])
      } catch {
        // Mic denied — no session created
      }
      return
    }

    setScrollToRecordingId(targetId)

    const control = recordingControlsRef.current.get(targetId)
    if (!control) {
      pendingMobileArmRef.current = targetId
      return
    }

    const state = control.getState()
    if (state === 'idle') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        await control.arm(stream)
      } catch {
        // Mic denied
      }
    } else if (state === 'armed') {
      void control.startRecord()
    }
  }, [activeRecordingId, recordingSessions])

  function handleRecordingArm(id: string) {
    setActiveRecordingId(id)
  }

  function handleRecordingRelease(id: string) {
    setActiveRecordingId(prev => (prev === id ? null : prev))
  }

  async function handleRecordingSaved(id: string, track: Track) {
    trackEvent('recording_saved', { duration_ms: track.duration_ms ?? 0 })
    setRecordingSessions(prev => prev.filter(s => s.id !== id))
    setActiveRecordingId(prev => (prev === id ? null : prev))
    setVersions(prev => prev.map(v =>
      v.id === activeVersionId ? { ...v, tracks: [...v.tracks, track] } : v
    ))
    cache.invalidate(activeVersionId)
    await loadProject()
  }

  function handleRecordingDelete(id: string) {
    trackEvent('recording_discarded')
    setRecordingSessions(prev => prev.filter(s => s.id !== id))
    setActiveRecordingId(prev => (prev === id ? null : prev))
    setRecordingPreviewEnds(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleRecordingPreviewTimeline(id: string, endSec: number | null) {
    setRecordingPreviewEnds(prev => {
      if (endSec != null && endSec > 0) {
        if (prev[id] === endSec) return prev
        return { ...prev, [id]: endSec }
      }
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleRecordingNameChange(id: string, name: string) {
    setRecordingSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
  }

  // Spacebar toggles play/pause (skip when typing in inputs)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return

      e.preventDefault()

      if (recordingStopRef.current) {
        recordingStopRef.current()
        return
      }

      const p = playerRef.current
      if (p.total > 0 && p.loaded < p.total) return

      const canPlay = p.duration > 0 || p.total > 0
      if (!canPlay) return

      if (p.playing || p.isCounting) p.pause()
      else p.play()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!commentMode) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showBranchModal || mergeModal || showTour || showMobileTour) return
      const el = e.target as HTMLElement
      if (el.closest('[role="dialog"]')) return
      setCommentMode(false)
      setActiveCommentInput(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commentMode, showBranchModal, mergeModal, showTour, showMobileTour])

  const durationMs = player.duration * 1000
  // Total bars: max(start_bar + durationBars) across ALL tracks.
  // Duration uses project BPM for all track types (including MIDI).
  function effectiveTrackDurationMs(t: Track): number {
    return trackContentDurationMs(
      t,
      projBpm,
      decodedDurationMs.get(t.id) ?? player.trackDurations.get(t.id),
    )
  }
  const totalProjectDurationMs = Math.max(totalProjectBars * projBarDurationMs, durationMs, 1)

  function handleTrackDuration(trackId: string, ms: number) {
    playerRef.current.noteTrackDuration(trackId, ms)
    setDecodedDurationMs(prev => {
      if (prev.get(trackId) === ms) return prev
      const next = new Map(prev)
      next.set(trackId, ms)
      return next
    })
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => {
        if (t.id !== trackId) return t
        if (t.duration_ms != null && t.duration_ms >= ms) return t
        return { ...t, duration_ms: ms }
      }),
    })))
  }

  // ── Auto-extend ruler during live recording ────────────────────────────────
  // When an empty project is being recorded into, totalProjectBars starts at 16.
  // As the playhead approaches the end, we add 16 bars at a time so the ruler,
  // transport, and metronome all keep going until recording stops (max 1000 bars).
  useEffect(() => {
    if (activeRecordingId === null) {
      setRecordingExtraBars(0)
      return
    }
    if (projBarDurationMs <= 0) return

    const barDurSec = projBarDurationMs / 1000
    const currentBar = playerRef.current.currentTimeRef.current / barDurSec
    const maxExtraBars = Math.max(0, MAX_PROJECT_BARS - baseProjectBars)

    setRecordingExtraBars(extra => {
      const currentTotal = Math.min(baseProjectBars + extra, MAX_PROJECT_BARS)
      if (currentBar < currentTotal - RECORDING_EXTEND_LEAD_BARS) return extra
      if (extra >= maxExtraBars) return extra
      return Math.min(extra + RECORDING_EXTEND_CHUNK_BARS, maxExtraBars)
    })
  }, [player.currentTime, activeRecordingId, baseProjectBars, projBarDurationMs])

  useEffect(() => {
    setDecodedDurationMs(new Map())
  }, [activeVersionId])

  useEffect(() => {
    if (player.trackDurations.size === 0) return
    setDecodedDurationMs(prev => {
      let changed = false
      const next = new Map(prev)
      for (const [id, ms] of player.trackDurations) {
        if (prev.get(id) !== ms) {
          next.set(id, ms)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [player.trackDurations])

  async function handleCommentCreate(trackId: string, startMs: number, endMs: number, content: string) {
    const res = await fetch(`/api/tracks/${trackId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, timecode_start_ms: startMs, timecode_end_ms: endMs }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Failed to save comment')
    }
    const { comment } = await res.json()
    trackEvent('comment_created')

    // Update versions state in-place
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, comments: [...(t.comments ?? []), comment] } : t)
    })))

    // Patch cache in-place — no re-fetch needed
    cache.patchComments(activeVersionId, trackId, cs => [...cs, comment])
  }

  async function handleCommentDelete(commentId: string) {
    await fetch(`/api/comments/${commentId}`, { method: 'DELETE' })
    trackEvent('comment_deleted')

    // Find which track the comment belonged to (for cache patching)
    let ownerTrackId = ''
    for (const v of versions) {
      for (const t of v.tracks) {
        if ((t.comments ?? []).some(c => c.id === commentId)) {
          ownerTrackId = t.id
          break
        }
      }
      if (ownerTrackId) break
    }

    // Update versions state in-place
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => ({ ...t, comments: (t.comments ?? []).filter(c => c.id !== commentId) }))
    })))

    // Patch cache in-place
    if (ownerTrackId) {
      cache.patchComments(activeVersionId, ownerTrackId, cs => cs.filter(c => c.id !== commentId))
    }
  }

  async function handleDeleteTrack(trackId: string) {
    const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Delete failed')
    }
    trackEvent('track_deleted')
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.filter(t => t.id !== trackId),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleColorUpdate(trackId: string, color: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, icon_color: color } : t),
    })))
  }

  function handleRenameTrack(trackId: string, newName: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, display_name: newName } : t),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleMidiDataUpdate(trackId: string, updates: Partial<Track>) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, ...updates } : t),
    })))
    cache.invalidate(activeVersionId)
  }

  async function handleStartBarUpdate(trackId: string, startBar: number) {
    const res = await fetch(`/api/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_bar: startBar }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error ?? 'Failed to save track offset')
    }
    trackEvent('track_offset_changed')

    const updatedTracks = activeTracks.map(t => t.id === trackId
      ? { ...t, start_bar: startBar, midi_start_bar: startBar }
      : t)
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId
        ? { ...t, start_bar: startBar, midi_start_bar: startBar }
        : t),
    })))
    cache.invalidate(activeVersionId)
    if (player.playing) player.seek(player.currentTime, updatedTracks)
  }

  // ── Upload state helpers ────────────────────────────────────────────────────

  function mutUploads(fn: (prev: UploadItem[]) => UploadItem[]) {
    // Compute next from ref (synchronous), update ref immediately so subsequent
    // reads in the same tick see the latest value, then enqueue a React re-render.
    const next = fn(uploadsRef.current)
    uploadsRef.current = next
    setUploads(next)
  }

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    mutUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
  }

  function removeUpload(id: string) {
    mutUploads(prev => prev.filter(u => u.id !== id))
  }

  // ── Core upload flow ────────────────────────────────────────────────────────

  async function uploadFile(upload: UploadItem) {
    if (!activeVersionId) return
    try {
      // Step 1: Get presigned URL
      updateUpload(upload.id, { status: 'presigning', error: undefined })

      const presignRes = await fetch(`/api/versions/${activeVersionId}/tracks/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: upload.file.name,
          fileSize: upload.file.size,
          contentType: upload.file.type || 'application/octet-stream',
        }),
      })
      if (!presignRes.ok) {
        const msg = (await presignRes.json().catch(() => ({}))).error ?? 'Failed to prepare upload'
        throw new Error(msg)
      }
      const { presignedUrl, tempKey } = await presignRes.json()

      // Step 2: Upload directly to R2
      updateUpload(upload.id, { status: 'uploading', tempKey, progress: 0 })

      await uploadToR2Direct(upload.file, presignedUrl, (percent) => {
        updateUpload(upload.id, { progress: percent })
      })

      // Step 3: Process on server (convert, hash, dedup, insert DB)
      updateUpload(upload.id, { status: 'processing', progress: 100 })

      const isMidi = upload.file.name.endsWith('.mid') || upload.file.name.endsWith('.midi')
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: upload.file.name,
          fileSize: upload.file.size,
          mimetype: upload.file.type || 'application/octet-stream',
          ...(isMidi ? { midiStartBar: 0 } : {}),
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }

      const { track: newTrack } = await processRes.json()
      if (newTrack) {
        setVersions(prev => prev.map(v =>
          v.id === activeVersionId
            ? { ...v, tracks: [...v.tracks.filter(t => t.id !== newTrack.id), newTrack] }
            : v,
        ))
      }

      updateUpload(upload.id, { status: 'done' })
      trackEvent('track_uploaded', { file_type: uploadFileType(upload.file) })
      cache.invalidate(activeVersionId)
      await loadProject(true, true)
      setTimeout(() => removeUpload(upload.id), 1500)

    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
      trackEvent('track_upload_failed', { file_type: uploadFileType(upload.file) })
    } finally {
      // After this upload finishes/errors, start any queued uploads
      setTimeout(() => processUploadQueue(), 0)
    }
  }

  function processUploadQueue() {
    const current = uploadsRef.current
    const active = current.filter(u =>
      u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
    )
    const pending = current.filter(u => u.status === 'pending')
    const slots = Math.max(0, MAX_CONCURRENT_UPLOADS - active.length)
    pending.slice(0, slots).forEach(u => uploadFile(u))
  }

  // ── Retry logic ─────────────────────────────────────────────────────────────

  async function retryProcessing(upload: UploadItem) {
    if (!activeVersionId || !upload.tempKey) return
    try {
      updateUpload(upload.id, { status: 'processing', progress: 100, error: undefined })
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey: upload.tempKey,
          originalFilename: upload.file.name,
          fileSize: upload.file.size,
          mimetype: upload.file.type || 'application/octet-stream',
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }
      const { track: newTrack } = await processRes.json()
      if (newTrack) {
        setVersions(prev => prev.map(v =>
          v.id === activeVersionId
            ? { ...v, tracks: [...v.tracks.filter(t => t.id !== newTrack.id), newTrack] }
            : v,
        ))
      }
      updateUpload(upload.id, { status: 'done' })
      trackEvent('track_uploaded', { file_type: uploadFileType(upload.file) })
      cache.invalidate(activeVersionId)
      await loadProject(true, true)
      setTimeout(() => removeUpload(upload.id), 1500)
    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Processing failed',
      })
      trackEvent('track_upload_failed', { file_type: uploadFileType(upload.file) })
    }
  }

  function retryUpload(uploadId: string) {
    const upload = uploadsRef.current.find(u => u.id === uploadId)
    if (!upload) return
    trackEvent('track_upload_retried', { file_type: uploadFileType(upload.file) })

    if (upload.tempKey) {
      // R2 upload succeeded — only processing failed; skip re-upload
      retryProcessing(upload)
    } else {
      // Full retry from scratch
      const reset: UploadItem = { ...upload, status: 'pending', progress: 0, error: undefined }
      updateUpload(uploadId, { status: 'pending', progress: 0, error: undefined })
      const active = uploadsRef.current.filter(u =>
        u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
      )
      if (active.length < MAX_CONCURRENT_UPLOADS) {
        uploadFile(reset)
      }
      // else processUploadQueue() will pick it up when a slot opens
    }
  }

  // ── Entry points ─────────────────────────────────────────────────────────────

  const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

function uploadFileType(file: File): 'audio' | 'midi' {
  return file.name.endsWith('.mid') || file.name.endsWith('.midi') ? 'midi' : 'audio'
}

  function handleUploadFiles(files: File[]) {
    if (!files.length || !activeVersionId) return
    if (storageFull) {
      setToast(storageQuotaError(storageUsed, storageLimit))
      setTimeout(() => setToast(null), 4000)
      return
    }

    const newUploads: UploadItem[] = []
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setToast(`${file.name} is too large (max 200MB)`)
        setTimeout(() => setToast(null), 4000)
        continue
      }
      newUploads.push({ id: crypto.randomUUID(), file, status: 'pending', progress: 0 })
    }
    if (!newUploads.length) return

    mutUploads(prev => [...prev, ...newUploads])

    // Kick off up to MAX_CONCURRENT_UPLOADS immediately
    const active = uploadsRef.current.filter(u =>
      u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
    )
    const slots = Math.max(0, MAX_CONCURRENT_UPLOADS - active.length)
    newUploads.slice(0, slots).forEach(u => uploadFile(u))
  }

  function handleAddTrack(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(isAcceptedFile)
    e.target.value = ''
    if (files.length) handleUploadFiles(files)
  }

  // Drag-and-drop helpers
  function isAcceptedFileDrag(e: React.DragEvent) {
    return Array.from(e.dataTransfer.items).some(it =>
      it.kind === 'file' && (it.type.startsWith('audio/') || it.type === '')
    )
  }
  function isAcceptedFile(f: File) {
    return (
      f.type.startsWith('audio/') ||
      f.name.endsWith('.wav') || f.name.endsWith('.mp3') ||
      f.name.endsWith('.mid') || f.name.endsWith('.midi')
    )
  }
  function handleContentDragOver(e: React.DragEvent) {
    if (!isAcceptedFileDrag(e)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }
  function handleContentDragLeave(e: React.DragEvent) {
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
    setIsDragging(false); setIsDraggingAddRow(false)
  }
  function handleContentDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false); setIsDraggingAddRow(false)
    const files = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
    if (!files.length) {
      setToast('Only WAV, MP3, and MIDI files are supported')
      setTimeout(() => setToast(null), 3000)
      return
    }
    handleUploadFiles(files)
  }
  function handleAddRowDragOver(e: React.DragEvent) {
    if (!isAcceptedFileDrag(e)) return
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'
    setIsDraggingAddRow(true)
  }
  function handleAddRowDragLeave(e: React.DragEvent) {
    e.stopPropagation()
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
    setIsDraggingAddRow(false)
  }
  function handleAddRowDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setIsDragging(false); setIsDraggingAddRow(false)
    const files = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
    if (files.length) handleUploadFiles(files)
  }

  async function handleReplaceTrack(track: Track, file: File) {
    if (storageFull) {
      alert(storageQuotaError(storageUsed, storageLimit))
      return
    }
    if (!activeVersionId) return
    setUploading(true)
    try {
      const presignRes = await fetch(`/api/versions/${activeVersionId}/tracks/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
        }),
      })
      if (!presignRes.ok) {
        const msg = (await presignRes.json().catch(() => ({}))).error ?? 'Failed to prepare upload'
        throw new Error(msg)
      }
      const { presignedUrl, tempKey } = await presignRes.json()

      await uploadToR2Direct(file, presignedUrl, () => {})

      const isMidi = file.name.endsWith('.mid') || file.name.endsWith('.midi')
      const startBar = track.start_bar ?? track.midi_start_bar ?? 0
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: file.name,
          fileSize: file.size,
          mimetype: file.type || 'application/octet-stream',
          name: track.name,
          position: track.position,
          iconColor: track.icon_color ?? undefined,
          ...(track.display_name ? { displayName: track.display_name } : {}),
          ...(isMidi ? { midiStartBar: startBar } : { startBar }),
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }

      const delRes = await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' })
      if (!delRes.ok) {
        throw new Error((await delRes.json().catch(() => ({}))).error ?? 'Failed to remove old track')
      }

      waveformBarsCache.delete(track.id)
      audioArrayBufferCache.delete(track.id)
      cache.invalidate(activeVersionId)
      trackEvent('track_replaced', { file_type: isMidi ? 'midi' : 'audio' })
      await loadProject(true, true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setUploading(false)
    }
  }

  function promptReplaceTrack(track: Track) {
    replaceTrackRef.current = track
    mobileReplaceInputRef.current?.click()
  }

  function handleMobileReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const track = replaceTrackRef.current
    const file = e.target.files?.[0]
    e.target.value = ''
    replaceTrackRef.current = null
    if (track && file) void handleReplaceTrack(track, file)
  }

  async function handleNewBranch(name: string, tag: string | null) {
    setShowBranchModal(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: activeVersionId, tag }),
      })
      const { version } = await res.json()
      trackEvent('version_created', { tag: tag || 'none' })
      cache.invalidate(activeVersionId)
      await loadProject()
      setActiveVersionId(version.id)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
  }

  function handleMergeClick(branchId: string) {
    trackEvent('merge_initiated')
    setMergeModal({ branchId })
  }

  async function handleMergeComplete({ tracksUpdated, branchName, targetName }: { tracksUpdated: number; branchName: string; targetName?: string }) {
    trackEvent('version_saved')
    const branchId = mergeModal?.branchId
    setMergeModal(null)
    if (branchId) cache.invalidate(branchId)
    const target = versions.find(v => v.name === targetName) ?? versions.find(v => v.type === 'main')
    if (target) cache.invalidate(target.id)
    await loadProject(false)
    const main = versions.find(v => v.type === 'main')
    setActiveVersionId(main?.id ?? branchId ?? '')
    const intoLabel = targetName ?? 'Master'
    const msg = `✓ "${branchName}" applied to ${intoLabel} — ${tracksUpdated} track${tracksUpdated !== 1 ? 's' : ''} updated`
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleReplyCreate(commentId: string, content: string) {
    const res = await fetch(`/api/comments/${commentId}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error('Failed')
    const { reply } = await res.json()
    trackEvent('comment_reply_added')

    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => ({
        ...t,
        comments: (t.comments ?? []).map(c =>
          c.id === commentId
            ? { ...c, replies: [...(c.replies ?? []), reply] }
            : c
        ),
      })),
    })))
  }

  const isOwner = false // project page doesn't fetch band membership; allow comment deletion by author only
  const currentUser = profile && profile.username ? { username: profile.username as string } : null

  const totalComments = activeTracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)
  const waveformsInteractive = useMemo(
    () => allTracksLoaded({
      tracksLoaded: player.loaded,
      tracksTotal: player.total,
      activeTracks,
      midiPlaybackReadyIds: player.midiPlaybackReadyIds,
    }),
    [player.loaded, player.total, activeTracks, player.midiPlaybackReadyIds],
  )

  const commentCounts: Record<string, number> = {}
  for (const v of versions) {
    commentCounts[v.id] = v.tracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)
  }

  async function handleShare() {
    trackEvent('share_clicked')
    const url = new URL(`/band/${bandId}/project/${projectId}`, window.location.origin)
    if (activeVersionId) url.searchParams.set('v', activeVersionId)
    await navigator.clipboard.writeText(url.toString())
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  const toggleCommentMode = useCallback(() => {
    setCommentMode(m => {
      const next = !m
      trackEvent('comment_mode_toggled', { enabled: next })
      return next
    })
    setActiveCommentInput(null)
  }, [])

  const toggleEditStructure = useCallback(() => {
    setEditStructure(p => {
      if (!p) trackEvent('structure_edit_opened')
      return !p
    })
  }, [])

  const togglePlanOpen = useCallback(() => {
    setPlanOpen(o => {
      if (!o) trackEvent('roadmap_opened')
      return !o
    })
  }, [])

  const openAddTrackPicker = useCallback(() => {
    trackEvent('add_track_clicked')
    fileInputRef.current?.click()
  }, [])

  const headerActions = (
    <>
      <TbBtn variant="ghost" className="hidden lg:inline-flex" onClick={handleShare} data-tour="share-button">
        {shareCopied ? 'Copied!' : 'Share'}
      </TbBtn>
      <TbBtn
        variant="ghost"
        className="hidden lg:inline-flex"
        disabled={!canSaveVersion}
        onClick={() => canSaveVersion && handleMergeClick(activeVersionId)}
        data-tour="save-version-button"
        title={canSaveVersion ? 'Apply this version' : 'Switch to a version to apply changes'}
      >
        Save Version
      </TbBtn>
      <a
        href={`/api/versions/${activeVersionId}/export`}
        onClick={() => trackEvent('export_wav_clicked')}
        className="hidden sm:inline-flex bg-foreground text-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-lime hover:text-primary-foreground transition no-underline items-center"
      >
        Export WAV
      </a>
      {isMobileLandscape && (
        <CommentToggleBtn
          active={commentMode}
          count={totalComments}
          onClick={toggleCommentMode}
        />
      )}
      <TourHelpButton onClick={() => setShowTour(true)} />
    </>
  )

  if (!loading && (error || !project)) {
    const isAccessDenied = error === 'access_denied'
    const isNotFound = error === 'not_found' || !project

    return (
      <ResourceErrorScreen
        crumbs={<span className="text-muted-foreground">Project</span>}
        accessDenied={isAccessDenied}
        title={
          isAccessDenied
            ? "You don't have access to this project"
            : isNotFound
            ? 'Project not found'
            : 'Something went wrong'
        }
        description={
          isAccessDenied
            ? "This project belongs to a band you're not a member of. Ask a band member to invite you if you need access."
            : isNotFound
            ? "This project doesn't exist or may have been deleted."
            : 'We had trouble loading this project. Try refreshing the page.'
        }
        actions={[
          { label: 'Go to My Bands', href: '/dashboard', primary: true },
          ...(!isAccessDenied
            ? [{ label: 'Retry', onClick: () => window.location.reload() }]
            : []),
        ]}
      />
    )
  }

  return (
    <div className="project-page flex flex-col h-screen overflow-hidden bg-background">

      {/* Portrait mobile skeleton — CSS-class ensures it only shows on portrait mobile */}
      {!project && (
        <div className="skeleton-portrait-mobile"><MobilePortraitSkeleton /></div>
      )}

      {/* Portrait mobile — Rehearsal ⇄ Mixer tabs */}
      {isMobilePortrait && project && (
        <MobileExperience
          project={project}
          bandId={bandId}
          versions={versions}
          activeVersionId={activeVersionId}
          onVersionChange={selectVersion}
          player={{
            playing: player.playing,
            currentTime: player.currentTime,
            duration: player.duration,
            loaded: player.loaded,
            total: player.total,
            playbackReady: player.playbackReady,
            playbackMix: player.playbackMix,
            play: player.play,
            pause: player.pause,
            seek: player.seek,
            seekEpoch: player.seekEpoch,
            currentTimeRef: player.currentTimeRef,
          }}
          sections={sections}
          projectId={projectId}
          activeTracks={activeTracks}
          barDurationMs={projBarDurationMs}
          isMainVersion={activeVersion?.type === 'main'}
          sectionLoopOn={player.sectionLoopOn}
          sectionLoopEnabled={sectionLoopButtonEnabled}
          onToggleSectionLoop={handleToggleSectionLoop}
          metronomeOn={player.metronomeOn}
          countdownOn={player.countdownOn}
          isCounting={player.isCounting}
          onToggleMetronome={player.toggleMetronome}
          onToggleCountdown={player.toggleCountdown}
          onNewBranch={() => setShowBranchModal(true)}
          commentMode={commentMode}
          commentCount={totalComments}
          onToggleCommentMode={toggleCommentMode}
          mixer={{
            project,
            versionId: activeVersionId,
            versions,
            activeVersionId,
            onVersionChange: selectVersion,
            onNewBranch: () => setShowBranchModal(true),
            sections,
            onSectionsChange: setSections,
            sectionRanges,
            activeTracks,
            totalProjectBars,
            totalDurationMs: totalProjectDurationMs,
            barDurationMs: projBarDurationMs,
            player: {
              playing: player.playing,
              isCounting: player.isCounting,
              currentTime: player.currentTime,
              currentTimeRef: player.currentTimeRef,
              duration: player.duration,
              playbackReady: player.playbackReady,
              playbackMix: player.playbackMix,
              tracksLoaded: player.loaded,
              tracksTotal: player.total,
              play: player.play,
              pause: player.pause,
              seek: player.seek,
              seekEpoch: player.seekEpoch,
              sectionLoopOn: player.sectionLoopOn,
              sectionLoopEnabled: sectionLoopButtonEnabled,
              onToggleSectionLoop: handleToggleSectionLoop,
              metronomeOn: player.metronomeOn,
              countdownOn: player.countdownOn,
              onToggleMetronome: player.toggleMetronome,
              onToggleCountdown: player.toggleCountdown,
            },
            mutedTracks: player.mutedTracks,
            soloedTracks: player.soloedTracks,
            midiRenderingTracks: player.midiRenderingTracks,
            onToggleMute: player.toggleMute,
            onToggleSolo: player.toggleSolo,
            onAddTrack: openAddTrackPicker,
            onAddRecording: handleAddRecordingTrack,
            storageFull,
            onReplaceTrack: promptReplaceTrack,
            onDeleteTrack: handleDeleteTrack,
            onColorUpdate: handleColorUpdate,
            onRecordTransport: () => { void handleMobileRecordTransport() },
            recordingTransportState: (() => {
              const id = activeRecordingId ?? recordingSessions[recordingSessions.length - 1]?.id
              return id ? (recordingRowStates[id] ?? 'idle') : 'idle'
            })(),
            scrollToRecordingId,
            onRecordingScrollDone: () => setScrollToRecordingId(null),
            commentMode,
            onToggleCommentMode: toggleCommentMode,
            commentCount: totalComments,
            activeCommentInput,
            onCommentPlace: setActiveCommentInput,
            onCommentDelete: handleCommentDelete,
            onCommentCreate: handleCommentCreate,
            onCloseCommentInput: () => setActiveCommentInput(null),
            onReplyCreate: handleReplyCreate,
            currentUserId: user?.id,
            isOwner,
            currentUser,
            waveformsInteractive,
            recordingSlot: recordingSessions.map(session => (
              <RecordingTrackRow
                key={session.id}
                id={session.id}
                name={session.name}
                onNameChange={handleRecordingNameChange}
                versionId={activeVersionId}
                bpm={projBpm}
                timeSig={projTimeSig}
                totalBars={totalProjectBars}
                countdownEnabled={player.countdownOn}
                getPlaybackMs={getRecordingPlaybackMs}
                isPlaying={player.playing}
                seekEpoch={player.seekEpoch}
                isActiveRecording={activeRecordingId !== null && activeRecordingId !== session.id}
                onArm={handleRecordingArm}
                onRelease={handleRecordingRelease}
                onSaved={handleRecordingSaved}
                onDelete={handleRecordingDelete}
                onPlaybackStart={player.playTransport}
                onPlaybackStop={player.pause}
                onSeekTo={player.seek}
                onPreparePlayback={player.prepareTransport}
                onPreviewTimelineChange={handleRecordingPreviewTimeline}
                recordingStopRef={recordingStopRef}
                playCountdown={beginRecordingCountdown}
                registerControl={registerRecordingControl}
                onStateChange={handleRecordingStateChange}
                mobileScrollableTimeline
              />
            )),
          }}
          onOpenChat={openChat}
          chatUnread={chatUnread}
          showTour={showMobileTour}
          onTourFinish={() => {
            setShowMobileTour(false)
            updateOnboarding('mobile_project_tour_completed', true)
            setToast("You're all set! Tap ? anytime for a refresher.")
            setTimeout(() => setToast(null), 4000)
          }}
          onTourSkip={() => {
            setShowMobileTour(false)
            updateOnboarding('mobile_project_tour_skipped', true)
          }}
          storageFull={storageFull}
        />
      )}

      <input
        ref={mobileReplaceInputRef}
        type="file"
        accept="audio/*,.mid,.midi"
        className="hidden"
        onChange={handleMobileReplaceFile}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
        multiple
        className="hidden"
        onChange={handleAddTrack}
      />

      {!isMobilePortrait && (
      <>
      {/* Header */}
      {isShortLandscape ? (
        <header className="flex items-center shrink-0 px-4 h-9 border-b border-border bg-background mixer-topbar topbar-compact">
          <button
            type="button"
            className="project-sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Toggle sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3.5" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              <rect x="2" y="7.375" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              <rect x="2" y="11.25" width="12" height="1.25" rx="0.6" fill="currentColor"/>
            </svg>
          </button>
          <span className="text-[11px] truncate flex-1 text-muted-foreground uppercase tracking-widest">{project?.name}</span>
          <CommentToggleBtn
            active={commentMode}
            count={totalComments}
            onClick={toggleCommentMode}
            className="size-7"
          />
          <TourHelpButton onClick={() => setShowTour(true)} />
        </header>
      ) : (
        <AppHeader
          left={
            <button
              type="button"
              className="project-sidebar-toggle lg:hidden size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-lime hover:text-lime transition shrink-0"
              onClick={() => setSidebarOpen(v => !v)}
              aria-label="Toggle sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3.5" width="12" height="1.25" rx="0.6" fill="currentColor"/>
                <rect x="2" y="7.375" width="12" height="1.25" rx="0.6" fill="currentColor"/>
                <rect x="2" y="11.25" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              </svg>
            </button>
          }
          crumbs={
            project ? (
              <>
                <Link href={`/band/${bandId}`} className="tb-type-name text-xs hover:text-foreground no-underline text-muted-foreground">
                  {project.band_name ?? 'Band'}
                </Link>
                <span className="text-border">/</span>
                <span className="tb-type-name text-xs text-foreground truncate">{project.name}</span>
              </>
            ) : (
              <>
                <Skeleton width={72} height={12} className="inline-block align-middle" />
                <span className="text-border">/</span>
                <Skeleton width={120} height={14} className="inline-block align-middle" />
              </>
            )
          }
          right={headerActions}
        />
      )}

      {isMobileLandscape && (
        <MobileMixerVersionBar
          versions={versions}
          activeId={activeVersionId}
          onSelect={selectVersion}
          onNewBranch={() => setShowBranchModal(true)}
          commentMode={commentMode}
          commentCount={totalComments}
          onToggleCommentMode={toggleCommentMode}
        />
      )}

      {/* Short-landscape bottom sheet — all topbar actions */}
      {topbarSheetOpen && (
        <>
          <div
            onClick={() => setTopbarSheetOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300 }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: 'var(--bg-surface)',
            borderTop: '0.5px solid var(--border)',
            borderRadius: '12px 12px 0 0',
            padding: '8px 0 12px',
          }}>
            {/* Sheet handle */}
            <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 8px' }} />
            <button onClick={() => { handleShare(); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M5.5 9a2.5 2.5 0 0 1 0-5h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M7.5 4a2.5 2.5 0 0 1 0 5h-1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Share link
            </button>
            <a href={`/api/versions/${activeVersionId}/export`} style={sheetBtnStyle} onClick={() => { trackEvent('export_wav_clicked'); setTopbarSheetOpen(false) }}>
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M3.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Export WAV
            </a>
            <button
              onClick={() => { if (canSaveVersion) { handleMergeClick(activeVersionId); setTopbarSheetOpen(false) } }}
              disabled={!canSaveVersion}
              style={{ ...sheetBtnStyle, opacity: !canSaveVersion ? 0.4 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M2 11V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4 6h5M4 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Save version
            </button>
            <button onClick={() => { setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              {resolvedTheme === 'dark'
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
              {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button onClick={() => { setShowTour(true); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Help
            </button>
          </div>
        </>
      )}

      {/* Body — only when project is loaded; header above always renders */}
      {project ? (<>
      <div className="flex flex-1 overflow-hidden">
        {/* Backdrop — only visible on tablet/mobile when sidebar is open */}
        <div
          className={`sidebar-backdrop${sidebarOpen ? ' sidebar-open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
        <Sidebar
          versions={versions} activeId={activeVersionId}
          onSelect={id => { selectVersion(id); if (window.innerWidth < 1024) setSidebarOpen(false) }}
          onNewBranch={() => setShowBranchModal(true)}
          onMerge={handleMergeClick}
          storageUsed={storageUsed}
          storageLimit={storageLimit}
          storageFull={storageFull}
          commentCounts={commentCounts}
          projectId={projectId}
          projectName={project?.name ?? ''}
          isOpen={sidebarOpen}
          compact={isMobileLandscape}
          isDark={resolvedTheme === 'dark'}
          resourceFilterTrackId={resourceFilterTrackId}
          resourceFilterTrackName={resourceFilterTrackName}
          onClearResourceFilter={() => setResourceFilterTrackId(null)}
          onNavigateResourceVersion={navigateResourceVersion}
          onNavigateResourceTrack={navigateResourceTrack}
        />

        <main
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background relative"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-track-row]')) {
              setResourceFilterTrackId(null)
            }
          }}
          onDragOver={handleContentDragOver}
          onDragLeave={handleContentDragLeave}
          onDrop={handleContentDrop}
        >
          {/* Full-screen drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-[200] pointer-events-none border-2 border-dashed border-lime bg-lime-soft/50 flex flex-col items-center justify-center gap-2">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-lime">
                <path d="M16 4v16M8 14l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 26h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-sm font-medium text-lime uppercase tracking-widest">Drop files to add tracks</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">WAV · MP3 · MIDI</span>
            </div>
          )}

          {/* Content — dimmed while dragging */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', opacity: isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}>

          {/* Project header */}
          {isMobileLandscape ? (
            <section className="border-b border-border bg-surface/40 shrink-0 px-4 py-1.5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums flex items-center gap-x-3 overflow-x-auto whitespace-nowrap scrollbar-none">
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                  variant="header"
                />
                <span>{project.time_signature ?? '4/4'}</span>
                <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                {player.duration > 0 && <span>{fmtTime(player.duration)}</span>}
              </div>
            </section>
          ) : (
          <section className="border-b border-border bg-surface/40 shrink-0">
            <div className="px-4 sm:px-6 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap min-w-0">
                {projectNameEditing ? (
                  <input
                    ref={projectNameInputRef}
                    value={projectNameValue}
                    onChange={e => setProjectNameValue(e.target.value.slice(0, 80))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitProjectRename()
                      if (e.key === 'Escape') setProjectNameEditing(false)
                    }}
                    onBlur={commitProjectRename}
                    className="tb-type-name text-xl uppercase tracking-tight bg-background border border-lime px-2 py-1 outline-none max-w-full"
                  />
                ) : (
                  <div className="flex items-center gap-2 group min-w-0" onDoubleClick={startProjectRename}>
                    <h1
                      className={`tb-type-name text-3xl sm:text-4xl uppercase tracking-tighter truncate m-0 transition-colors ${
                        projectNameFlash ? 'text-lime' : 'text-foreground'
                      }`}
                    >
                      {project.name}
                    </h1>
                    <button
                      type="button"
                      onClick={startProjectRename}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-lime bg-transparent border-0 cursor-pointer p-0"
                      title="Rename project"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
                {roadmap.configured && roadmap.stepIndex != null && (
                  <RoadmapPreview
                    steps={roadmap.steps}
                    stepIndex={roadmap.stepIndex}
                    stageSince={roadmap.stageSince}
                  />
                )}
                <div className="flex items-center gap-1.5 flex-wrap shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={togglePlanOpen}
                  className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border inline-flex items-center gap-1.5 transition ${
                    planOpen
                      ? 'bg-lime text-primary-foreground border-lime'
                      : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                  }`}
                >
                  {planOpen ? 'Hide plan' : 'Roadmap & checklist'}
                </button>
                <button
                  type="button"
                  onClick={toggleEditStructure}
                  disabled={activeTracks.length === 0}
                  data-tour="edit-structure-button"
                  className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition disabled:opacity-40 ${
                    editStructure || sections.length > 0
                      ? 'border-lime text-lime bg-lime-soft'
                      : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                  }`}
                >
                  {editStructure ? 'Done editing' : sections.length > 0 ? 'Edit structure' : '+ Add structure'}
                </button>
                <button
                  type="button"
                  onClick={toggleCommentMode}
                  data-tour="comments-toggle"
                  className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition ${
                    commentMode
                      ? 'bg-lime text-primary-foreground border-lime'
                      : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                  }`}
                >
                  {commentMode ? '● Comment mode' : `Comment mode${totalComments > 0 ? ` (${totalComments})` : ''}`}
                </button>
                </div>
              </div>

              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                  variant="header"
                />
                <span>{project.time_signature ?? '4/4'}</span>
                <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                {totalProjectDurationMs > 0 && <span>{fmtTime(totalProjectDurationMs / 1000)}</span>}
              </div>

              <div className="flex min-w-0 items-stretch">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap touch-pan-x overscroll-x-contain [&::-webkit-scrollbar]:hidden">
                  {versions.map(v => {
                    const isActive = v.id === activeVersionId
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => selectVersion(v.id)}
                        className={`shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition whitespace-nowrap ${
                          isActive
                            ? 'bg-lime text-primary-foreground border-lime'
                            : v.merged_at
                              ? 'border-border text-muted-foreground opacity-50'
                              : 'border-border hover:border-lime hover:text-lime text-muted-foreground'
                        }`}
                      >
                        {v.type === 'main' && '● '}
                        {v.merged_at && '✓ '}
                        {v.type === 'branch' && !v.merged_at && '⌥ '}
                        {v.name}
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowBranchModal(true)}
                  data-tour="new-branch-button"
                  className="shrink-0 self-stretch ml-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-dashed border-border hover:border-lime hover:text-lime text-muted-foreground transition"
                >
                  + New Version
                </button>
              </div>
            </div>
          </section>
          )}

          {/* Roadmap + checklist panel */}
          {planOpen && (
            <section className="border-b border-border bg-background shrink-0">
              <div className="px-4 sm:px-6 py-5 grid gap-5 lg:grid-cols-[1fr_minmax(300px,420px)] items-start">
                <SongRoadmap
                  projectId={projectId}
                  roadmap={roadmap}
                  onRoadmapChange={handleRoadmapChange}
                />
                <SongChecklist
                  items={checklist}
                  members={checklistMembers}
                  onToggle={handleChecklistToggle}
                  onUpdate={handleChecklistUpdate}
                  onDelete={handleChecklistDelete}
                  onAssign={handleChecklistAssign}
                  onAdd={handleChecklistAdd}
                />
              </div>
            </section>
          )}

          {/* Structure + transport — bar ruler, sections, play/time/volume */}
          {project && (
            <StructureOverlay
              project={project}
              versionId={activeVersionId}
              totalDurationMs={totalProjectDurationMs}
              tracks={activeTracks}
              sections={sections}
              onSectionsChange={setSections}
              editMode={isMobileLandscape ? false : editStructure}
              onEditModeChange={setEditStructure}
              waveformBounds={waveformBounds}
              currentTimeMs={player.currentTime * 1000}
              currentTimeRef={player.currentTimeRef}
              playing={player.playing}
              onSeek={player.seek}
              compact={isMobileLandscape}
              seekEnabled={waveformsInteractive}
            />
          )}

          {/* Comment mode banner — desktop only; mobile uses top-bar icon */}
          {!isMobileLandscape && (
          <div className={`overflow-hidden transition-[height,opacity] duration-200 shrink-0 ${commentMode ? 'h-9 opacity-100' : 'h-0 opacity-0'}`}>
            <div className="flex items-center gap-2 px-4 sm:px-6 h-9 bg-lime-soft border-b border-lime/30">
              <span className="text-[10px] uppercase tracking-widest text-lime">
                ● Comment mode — click-drag on any waveform to select a time range
              </span>
            </div>
          </div>
          )}

          {/* Track list */}
          <div ref={trackListRef} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none relative">
            <div ref={tracksBodyRef} className="relative">

              {/* Tact grid + section boundary overlays */}
              {totalProjectBars > 0 && (() => {
                const { barDurationMs } = getBarMath(project!, totalProjectDurationMs)
                const wl = waveformBounds?.left ?? TRACK_LABEL_W
                const wr = waveformBounds?.right ?? 68
                return (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: wl, right: wr,
                    pointerEvents: 'none', zIndex: 1,
                  }}>
                    <TactGrid totalBars={totalProjectBars} barDurationMs={barDurationMs} totalDurationMs={totalProjectDurationMs} />
                    {sections.length > 0 && totalProjectDurationMs > 0 && [...new Set(sections.flatMap(s => [
                      ...(s.start_bar > 0 ? [s.start_bar] : []),
                      s.end_bar,
                    ]))].map(bar => {
                      const pct = (bar * barDurationMs) / totalProjectDurationMs
                      return (
                        <div
                          key={bar}
                          style={{
                            position: 'absolute', top: 0, height: '100%',
                            left: `${pct * 100}%`,
                            width: 0,
                            borderLeft: '1px dashed rgba(128,128,128,0.45)',
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })()}

              {activeTracks.length === 0 ? (
                <div className="px-4 sm:px-6 py-12 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                  {versionLoading ? 'Loading tracks…' : 'No tracks yet — add one below'}
                </div>
              ) : activeTracks.map((t, i) => (
                <TrackRow
                  key={t.id} track={t} index={i}
                  muted={player.mutedTracks.has(t.id) || player.midiRenderingTracks.has(t.id)}
                  soloed={player.soloedTracks.has(t.id)} changed={isChanged(t)}
                  currentTimeRef={player.currentTimeRef}
                  commentMode={commentMode} activeInput={activeCommentInput}
                  audioReady={
                    t.file_type === 'midi'
                      ? player.midiPlaybackReadyIds.has(t.id)
                      : player.loaded >= player.total && player.total > 0
                  }
                  midiRendering={player.midiRenderingTracks.has(t.id)}
                  waitForMidiRender={player.waitForMidiRender}
                  onToggleMute={() => player.toggleMute(t.id)}
                  onToggleSolo={() => player.toggleSolo(t.id)}
                  onReplace={f => handleReplaceTrack(t, f)}
                  onCommentPlace={setActiveCommentInput}
                  onCommentDelete={handleCommentDelete}
                  onCommentCreate={handleCommentCreate}
                  onCloseInput={() => setActiveCommentInput(null)}
                  onDeleteTrack={handleDeleteTrack}
                  onRenameTrack={handleRenameTrack}
                  onColorUpdate={handleColorUpdate}
                  onMidiDataUpdate={handleMidiDataUpdate}
                  onStartBarUpdate={handleStartBarUpdate}
                  onDragStartOffset={() => setDraggingTrackId(t.id)}
                  onDragEndOffset={() => setDraggingTrackId(null)}
                  otherTrackDragging={draggingTrackId !== null && draggingTrackId !== t.id}
                  waveformDimmed={
                    player.mutedTracks.has(t.id)
                    || player.midiRenderingTracks.has(t.id)
                    || (player.soloedTracks.size > 0 && !player.soloedTracks.has(t.id))
                  }
                  waveformsInteractive={waveformsInteractive}
                  currentUserId={user?.id}
                  isOwner={isOwner}
                  onReplyCreate={handleReplyCreate}
                  currentUser={currentUser}
                  projectId={projectId}
                  versionId={activeVersionId}
                  project={project}
                  totalBars={totalProjectBars}
                  runtimeDurationMs={effectiveTrackDurationMs(t)}
                  timelineDurationMs={totalProjectDurationMs}
                  onTrackDuration={handleTrackDuration}
                  compact={isMobileLandscape}
                  resourceFilterActive={resourceFilterTrackId === t.id}
                  onResourceFilter={setResourceFilterTrackId}
                />
              ))}
              {recordingSessions.map(session => (
                <RecordingTrackRow
                  key={session.id}
                  id={session.id}
                  name={session.name}
                  onNameChange={handleRecordingNameChange}
                  versionId={activeVersionId}
                  bpm={projBpm}
                  timeSig={projTimeSig}
                  totalBars={totalProjectBars}
                  countdownEnabled={player.countdownOn}
                  getPlaybackMs={getRecordingPlaybackMs}
                  isPlaying={player.playing}
                  seekEpoch={player.seekEpoch}
                  isActiveRecording={activeRecordingId !== null && activeRecordingId !== session.id}
                  onArm={handleRecordingArm}
                  onRelease={handleRecordingRelease}
                  onSaved={handleRecordingSaved}
                  onDelete={handleRecordingDelete}
                  onPlaybackStart={player.playTransport}
                  onPlaybackStop={player.pause}
                  onSeekTo={player.seek}
                  onPreparePlayback={player.prepareTransport}
                  onPreviewTimelineChange={handleRecordingPreviewTimeline}
                  recordingStopRef={recordingStopRef}
                  playCountdown={beginRecordingCountdown}
                />
              ))}

              {/* Upload progress rows */}
              {uploads.length >= 2 && uploads.some(u => u.status !== 'done' && u.status !== 'error') && (
                <div style={{ padding: '6px 22px', background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                    Uploading {uploads.filter(u => u.status !== 'done' && u.status !== 'error').length} files…
                  </span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${uploads.reduce((s, u) => s + u.progress, 0) / Math.max(uploads.length, 1)}%`,
                      height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}
              {uploads.map(u => (
                <UploadRow
                  key={u.id}
                  upload={u}
                  onRetry={() => retryUpload(u.id)}
                  onDismiss={() => removeUpload(u.id)}
                />
              ))}

              {/* Add track — uikit split row */}
              <div
                data-tour="add-track-row"
                className="flex border-t border-border"
                onDragOver={handleAddRowDragOver}
                onDragLeave={handleAddRowDragLeave}
                onDrop={handleAddRowDrop}
              >
                <div
                  className="shrink-0 border-r border-border"
                  style={{ width: TRACK_LABEL_W }}
                >
                  <button
                    type="button"
                    onClick={openAddTrackPicker}
                    disabled={uploading || storageFull}
                    className={`w-full min-h-[60px] p-4 text-left text-[10px] uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isDraggingAddRow
                        ? 'text-lime bg-lime-soft'
                        : 'text-muted-foreground hover:text-lime hover:bg-surface/30'
                    }`}
                  >
                    {isDraggingAddRow ? '↓ Drop to add track' : '+ Add track'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddRecordingTrack}
                    disabled={!activeVersionId || storageFull}
                    data-tour="record-track-button"
                    className="w-full min-h-[48px] px-4 text-left text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime hover:bg-surface/30 transition disabled:opacity-40 disabled:cursor-not-allowed border-t border-border flex items-center gap-2"
                  >
                    <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
                    Record track
                  </button>
                </div>
                <div className="flex-1 min-h-[108px] relative overflow-hidden">
                  <TactGrid totalBars={totalProjectBars} barDurationMs={projBarDurationMs} totalDurationMs={totalProjectDurationMs} />
                </div>
              </div>
              {uploads.some(u => u.status !== 'done' && u.status !== 'error') && (
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground px-4 sm:px-6 py-2 m-0 border-t border-border">
                  {uploads.filter(u => u.status !== 'done' && u.status !== 'error').length > 1
                    ? `Uploading ${uploads.filter(u => u.status !== 'done' && u.status !== 'error').length} files…`
                    : (() => {
                        const u = uploads.find(u => u.status !== 'done' && u.status !== 'error')
                        return u?.status === 'uploading'
                          ? `Uploading… ${u.progress}%`
                          : u?.status === 'processing' ? 'Processing…' : 'Preparing…'
                      })()
                  }
                </p>
              )}
            </div>
          </div>

          </div>{/* end content dim wrapper */}
        </main>
      </div>

      <MasterPlayerBar
        playing={player.playing}
        currentTime={player.currentTime}
        currentTimeRef={player.currentTimeRef}
        duration={Math.max(player.duration, totalProjectDurationMs / 1000)}
        loaded={player.loaded}
        total={player.total}
        volume={player.volume}
        onPlay={player.play}
        onPause={player.pause}
        onSeek={player.seek}
        onVolume={player.setVolume}
        metronomeOn={player.metronomeOn}
        countdownOn={player.countdownOn}
        isCounting={player.isCounting}
        onToggleMetronome={player.toggleMetronome}
        onToggleCountdown={player.toggleCountdown}
        sectionLoopOn={player.sectionLoopOn}
        sectionLoopEnabled={sectionLoopButtonEnabled}
        onToggleSectionLoop={handleToggleSectionLoop}
        compact={isMobileLandscape}
      />

      {!isMobileLandscape && (
      <StatusFooter
        left={
          <span className="uppercase tracking-widest truncate hidden sm:inline">
            {project.bpm != null && `${project.bpm} BPM · `}
            {project.key && `${project.key} · `}
            {project.time_signature ?? '4/4'} · {activeTracks.length} TRACKS · {totalComments} COMMENTS
          </span>
        }
        right={<span className="uppercase tracking-widest hidden sm:inline">{project.name.toUpperCase()}</span>}
      />
      )}
      </>) : (
        /* Loading body — AppHeader above is always visible */
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            versions={versions}
            activeId={activeVersionId}
            onSelect={selectVersion}
            onNewBranch={() => setShowBranchModal(true)}
            onMerge={handleMergeClick}
            storageUsed={storageUsed}
            storageLimit={storageLimit}
            storageFull={storageFull}
            commentCounts={commentCounts}
            projectId={projectId}
            projectName=""
            isOpen={sidebarOpen}
            compact={isMobileLandscape}
            isDark={resolvedTheme === 'dark'}
          />
          <main className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background">
            <div className="flex flex-col flex-1 overflow-hidden">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-2 px-4 py-2 border-b border-border">
                  <Skeleton width={24} height={24} className="shrink-0" />
                  <div className="flex flex-col gap-0.5 w-24 shrink-0">
                    <Skeleton width="80%" height={10} />
                    <Skeleton width="55%" height={8} />
                  </div>
                  <Skeleton width="100%" height={36} className="flex-1" />
                </div>
              ))}
            </div>
          </main>
        </div>
      )}
      </>
      )}

      {/* Onboarding tour */}
      <ProjectTour
        projectName={project?.name ?? 'this project'}
        show={showTour && isDesktopMixer}
        onFinish={() => {
          setShowTour(false)
          updateOnboarding('project_tour_completed', true)
          setToast("You're all set! Click the ? icon anytime for a refresher.")
          setTimeout(() => setToast(null), 4000)
        }}
        onSkip={() => {
          setShowTour(false)
          updateOnboarding('project_tour_skipped', true)
        }}
      />

      {showBranchModal && <NewBranchModal onConfirm={handleNewBranch} onCancel={() => setShowBranchModal(false)} />}

      {mergeModal && (
        <MergeModal
          projectId={projectId}
          branchId={mergeModal.branchId}
          versions={versions}
          onClose={() => setMergeModal(null)}
          onMerged={handleMergeComplete}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} />}

      <ChatDock
        bandId={bandId}
        open={chatOpen}
        onOpen={openChat}
        onClose={closeChat}
        initialChannelKey={projectId}
        currentUserId={user?.id}
        currentProjectId={projectId}
        onSwitchVersion={selectVersion}
        onUnreadChange={setChatUnread}
      />
    </div>
  )
}

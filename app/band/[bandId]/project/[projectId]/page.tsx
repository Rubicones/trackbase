'use client'

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { TrackComment, CommentReply, Track, Version, Project, Section, MidiTrackData } from '@/lib/types'
import { useVersionCache } from '@/hooks/useVersionCache'
import { useAuth } from '@/contexts/AuthContext'
import { ProjectTour } from '@/components/onboarding/ProjectTour'
import { MergeModal } from './MergeModal'
import type { MergePreview } from './MergeModal'
import StructureOverlay, { getBarMath } from '@/components/StructureEditor'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { ProjectResourcesButton } from '@/components/ResourcesModal'
import { AppHeader, SectionLabel, StatusFooter } from '@/components/design/AppShell'
import { Toast } from '@/components/design/Toast'
import { TactGrid } from '@/components/design/TactGrid'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { UserAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { waveformBarsCache, fetchTrackAudioBuffer } from '@/lib/waveformCache'
import { ReadingMode } from '@/components/ReadingMode'
import { resolveTrackIconColor } from '@/lib/trackIcon'
import { trackColorAt, getTrackIconSwatches } from '@/lib/trackPalette'
import { usePalette } from '@/contexts/PaletteContext'
import { BrandSpinner } from '@/components/BrandSpinner'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import PianoRollEditor from '@/components/PianoRollEditor'
import { gmProgramLabel, sixteenthDuration, sixteenthsPerBar, gmInstrumentName } from '@/lib/midi'
import {
  METRONOME_TRACK_ID,
  generateMetronomeBuffer,
  snapToPreviousBarSec,
  startCountdown,
} from '@/lib/metronomeAudio'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { RecordingTrackRow } from '@/components/RecordingTrackRow'

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
    ghost: 'border border-border text-muted-foreground hover:border-ember hover:text-ember px-3 py-1.5',
    primary: 'bg-ember text-white border border-ember px-3 py-1.5 font-bold hover:brightness-110',
    solid: 'bg-foreground text-background px-3 py-1.5 font-bold hover:bg-ember',
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
          <span className="text-[10px] tabular-nums text-ember shrink-0">
            {fmtMs(comment.timecode_start_ms)} → {fmtMs(comment.timecode_end_ms)}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(comment.id) }}
              className="ml-auto text-muted-foreground hover:text-destructive transition-colors text-xs leading-none px-0.5"
              aria-label="Delete comment"
            >
              ✕
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
                className="text-[10px] uppercase tracking-widest text-ember hover:underline"
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
          ? 'border-ember bg-ember text-white'
          : 'border-border bg-surface-2 text-muted-foreground hover:border-ember hover:text-ember'
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
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-ember text-white text-[8px] font-bold leading-[14px] text-center">
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
        <div className="text-[10px] tabular-nums text-ember mb-2">
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

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({
  trackId, muted, playedRatio, color, durationMs,
  commentMode, comments, activeInput, audioReady,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput, onReady,
  currentUserId, isOwner, onReplyCreate, currentUser, onCommentInteractionChange,
  compact = false, barCount = 96,
}: {
  trackId: string; muted: boolean; playedRatio: number; color: string; durationMs: number
  commentMode: boolean; comments: TrackComment[]; activeInput: ActiveCommentInput | null; audioReady: boolean
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onReady?: () => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUser: { username: string } | null
  onCommentInteractionChange?: (commentId: string, active: boolean) => void
  compact?: boolean
  /** How many bars to render. Scale this proportionally to the clip's share of the timeline
   *  so each bar stays ~12 px wide regardless of clip length. Defaults to 96. */
  barCount?: number
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
          onReadyRef.current?.()
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
    if (!commentMode) return
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

  // Downsample 96-bar buffer to the requested bar count so bars stay visually wide
  // even when a short clip occupies only a small slice of the timeline.
  const displayCount = Math.max(4, barCount)
  function downsample(src: number[], n: number): number[] {
    if (src.length <= n) return src
    const out: number[] = []
    const step = src.length / n
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * step)
      const e = Math.min(src.length, Math.floor((i + 1) * step))
      let peak = 0
      for (let j = s; j < e; j++) peak = Math.max(peak, src[j])
      out.push(peak)
    }
    return out
  }
  const bars = ready
    ? downsample(barsRef.current, displayCount)
    : Array.from({ length: displayCount }, () => 0.12)

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-visible px-1 py-2"
      style={{ cursor, userSelect: 'none', WebkitUserSelect: 'none', touchAction: commentMode ? 'none' : 'auto' } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      onMouseMove={commentMode ? handleMouseMove : undefined}
      onTouchStart={commentMode ? handleTouchStart : undefined}
      onTouchMove={commentMode ? handleTouchMove : undefined}
    >
      <div className="absolute inset-x-1 top-2 bottom-2 flex items-center gap-px z-[1]">
        {bars.map((h, i) => {
          const played = (i / bars.length) < playedRatio
          return (
            <div
              key={i}
              className={`flex-1 min-w-0 ${ready ? 'animate-draw-wave' : ''}`}
              style={{
                height: `${Math.max(8, h * 100)}%`,
                background: color,
                opacity: muted ? 0.12 : played ? 0.95 : 0.4,
                animationDelay: ready ? `${i * 4}ms` : undefined,
              }}
            />
          )
        })}
      </div>

      {commentMode && !dragRect && (
        <div className="absolute inset-0 z-[2] pointer-events-none bg-ember/5 border border-dashed border-ember/40 grid place-items-center">
          <div className={`uppercase tracking-widest text-ember bg-background/90 border border-ember/40 ${
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

function usePlayer(
  tracks: Track[],
  versionId: string,
  project: Project | null,
  minPlaybackDuration = 0,
  timelineDurationSec = 0,
) {
  const actxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const bufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  const metronomeParamsRef = useRef<{ bpm: number; timeSig: string; duration: number } | null>(null)
  const startRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  // MIDI playback refs — soundfont notes scheduled via AudioContext
  const midiScheduledRef = useRef<{ stop: () => void }[]>([])
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    const saved = parseFloat(localStorage.getItem('trackbase_volume') ?? '')
    return isNaN(saved) ? 1 : Math.max(0, Math.min(1, saved))
  })

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loaded, setLoaded] = useState(0)
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
  const minPlaybackDurationRef = useRef(minPlaybackDuration)
  minPlaybackDurationRef.current = minPlaybackDuration
  const timelineDurationSecRef = useRef(timelineDurationSec)
  timelineDurationSecRef.current = timelineDurationSec

  const getTransportDuration = useCallback(() => Math.max(
    duration,
    minPlaybackDurationRef.current,
    timelineDurationSecRef.current,
  ), [duration])

  // Only load audio tracks (MIDI tracks are handled separately via soundfont)
  const audioTracks = tracks.filter(t => t.file_type !== 'midi')
  const midiTracks = tracks.filter(t => t.file_type === 'midi')
  // Keep a ref so scheduleMidiNotes always has the latest list without extra deps
  const midiTracksRef = useRef(midiTracks)
  midiTracksRef.current = midiTracks
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  // Keep project ref stable so scheduleMidiNotes (useCallback with [] deps) can read it
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    if (!tracks.length) return
    let cancelled = false
    const ctx = getSharedAudioContext()
    actxRef.current = ctx
    if (masterGainRef.current) {
      try { masterGainRef.current.disconnect() } catch { /* ok */ }
    }
    const masterGain = ctx.createGain()
    masterGain.gain.value = volume
    masterGain.connect(getMasterOutput())
    masterGainRef.current = masterGain
    bufsRef.current = new Map()
    bufsRef.current.delete(METRONOME_TRACK_ID)
    metronomeParamsRef.current = null
    mutedTracksRef.current.add(METRONOME_TRACK_ID)
    setMutedTracks(prev => new Set([...prev, METRONOME_TRACK_ID]))
    setMetronomeOn(false)
    setLoaded(0)
    let maxDur = 0

    // MIDI tracks intentionally excluded from maxDur — the project timeline
    // is governed by audio-only duration. MIDI notes scheduled via soundfont
    // already play at the correct offset; they don't stretch the timeline.

    Promise.all(audioTracks.map(async t => {
      try {
        const ab = await fetchTrackAudioBuffer(t.id)
        if (!ab || cancelled) return
        const decoded = await ctx.decodeAudioData(ab)
        if (!cancelled) {
          bufsRef.current.set(t.id, decoded)
          const proj = projectRef.current
          const projBpmL = proj?.bpm ?? 120
          const projBeatsL = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
          const barDurSecL = (60 / projBpmL) * projBeatsL
          const trackOffL = (t.start_bar ?? 0) * barDurSecL
          maxDur = Math.max(maxDur, trackOffL + decoded.duration)
          const decodedMs = Math.round(decoded.duration * 1000)
          setTrackDurations(prev => {
            const next = new Map(prev)
            next.set(t.id, decodedMs)
            return next
          })
          setLoaded(c => c + 1)
        }
      } catch { /* skip */ }
    })).then(() => {
      if (!cancelled) {
        // Include MIDI + offsets so player duration matches the structure timeline
        for (const t of tracks) {
          const buf = bufsRef.current.get(t.id)
          maxDur = Math.max(maxDur, trackTimelineEndSec(
            t,
            projectRef.current?.bpm ?? 120,
            projectRef.current?.time_signature ?? '4/4',
            buf?.duration,
          ))
        }
        setDuration(maxDur)
      }
    })
    return () => {
      cancelled = true
      sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
      sourcesRef.current = []
      cancelAnimationFrame(rafRef.current)
      midiScheduledRef.current.forEach(n => { try { n.stop() } catch { /* ok */ } })
      midiScheduledRef.current = []
      if (masterGainRef.current) {
        try { masterGainRef.current.disconnect() } catch { /* ok */ }
        masterGainRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId])

  // Recompute timeline when track offsets/metadata change (without reloading audio)
  useEffect(() => {
    const proj = projectRef.current
    if (!proj || !tracks.length) return
    let maxDur = 0
    for (const t of tracks) {
      const buf = bufsRef.current.get(t.id)
      maxDur = Math.max(maxDur, trackTimelineEndSec(
        t,
        proj.bpm ?? 120,
        proj.time_signature ?? '4/4',
        buf?.duration,
      ))
    }
    if (maxDur > 0) setDuration(maxDur)
  }, [tracks])

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
    const tracksReady = audioTracks.length === 0 || loaded >= audioTracks.length
    if (!tracksReady) return
    ensureMetronomeBuffer(ctx)
  }, [duration, loaded, audioTracks.length, project?.bpm, project?.time_signature, minPlaybackDuration, timelineDurationSec, ensureMetronomeBuffer])

  const stopSources = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
    // Stop scheduled MIDI notes
    midiScheduledRef.current.forEach(n => { try { n.stop() } catch { /* ok */ } })
    midiScheduledRef.current = []
  }, [])

  // audioCtxPlayTime: ctx.currentTime captured at the moment playback started,
  // BEFORE any async work. This ensures notes are scheduled relative to the
  // true audio start, not some later time after soundfont loading.
  const scheduleMidiNotes = useCallback(async (offset: number, audioCtxPlayTime: number) => {
    const ctx = actxRef.current
    if (!ctx) return
    const proj = projectRef.current
    // Always use PROJECT BPM for scheduling — never the MIDI file's internal tempo.
    // MIDI file BPM is only used during parsing (tick→sixteenth conversion) which
    // is already done; midiData.notes are stored in sixteenths independent of tempo.
    const projBpm = proj?.bpm ?? 120
    const projTimeSig = proj?.time_signature ?? '4/4'
    const [projN, projD] = projTimeSig.split('/').map(Number)
    const projSpb = sixteenthsPerBar(projN || 4, projD || 4)
    // sixteenthDuration uses project BPM: (60 / bpm) / 4
    const sixthSec = sixteenthDuration(projBpm)
    const projBarDurationSec = projSpb * sixthSec

    for (const midiTrack of midiTracksRef.current) {
      const hasSolosMidi = soloedTracksRef.current.size > 0
      if (hasSolosMidi ? !soloedTracksRef.current.has(midiTrack.id) : mutedTracksRef.current.has(midiTrack.id)) continue
      const data = midiTrack.midi_data
      if (!data || !data.notes.length) continue
      try {
        const { default: Soundfont } = await import('soundfont-player')
        const instrName = gmInstrumentName(data.instrument)
        const instrument = await Soundfont.instrument(ctx, instrName, { soundfont: 'MusyngKite' })
        // Bar offset in seconds (project bars × bar duration at project BPM)
        const startOffsetSec = (midiTrack.start_bar ?? midiTrack.midi_start_bar ?? 0) * projBarDurationSec
        for (const note of data.notes) {
          // Absolute project-timeline position of this note (in seconds)
          const noteAbsoluteSec = startOffsetSec + note.startSixteenth * sixthSec
          const noteDurSec = note.durationSixteenths * sixthSec
          // Skip notes entirely before the playback start position
          if (noteAbsoluteSec + noteDurSec < offset) continue
          // AudioContext time when this note should sound:
          // = time playback started + (note position − playback offset)
          const schedTime = audioCtxPlayTime + (noteAbsoluteSec - offset)
          if (schedTime < ctx.currentTime - 0.01) continue // missed — skip
          const scheduled = instrument.play(note.pitch.toString(), schedTime, {
            duration: noteDurSec,
            gain: note.velocity / 127,
          })
          midiScheduledRef.current.push(scheduled)
        }
      } catch { /* no soundfont — skip */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const ctx = ensurePlaybackGraph()
    ensureMetronomeBuffer(ctx)
    stopSources()
    if (ctx.state === 'suspended') await ctx.resume()
    const newGains = new Map<string, GainNode>()
    const proj = projectRef.current
    const projBpmP = proj?.bpm ?? 120
    const projBeatsP = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
    const projBarDurSecP = (60 / projBpmP) * projBeatsP
    const metaTracks = (tracksOverride ?? tracksRef.current).filter(t => t.file_type !== 'midi')
    const trackMetaMap = new Map(metaTracks.map(t => [t.id, t]))
    // Capture AudioContext time ONCE before starting any sources — used as
    // absolute reference for both audio scheduling and MIDI note scheduling.
    const audioCtxPlayTime = scheduledStartTime != null
      ? Math.max(scheduledStartTime, ctx.currentTime)
      : ctx.currentTime
    bufsRef.current.forEach((buf, id) => {
      const isMetronome = id === METRONOME_TRACK_ID
      const trackMeta = isMetronome ? null : trackMetaMap.get(id)
      if (!isMetronome && !trackMeta) return
      const trackOffsetSec = isMetronome ? 0 : (trackMeta!.start_bar ?? 0) * projBarDurSecP
      const trackEndSec = trackOffsetSec + buf.duration
      // Skip tracks that end before the playback position
      if (trackEndSec <= offset) return
      const g = ctx.createGain()
      const hasSolos = soloedTracksRef.current.size > 0
      if (isMetronome) {
        g.gain.value = metronomeOnRef.current ? 1 : 0
      } else {
        g.gain.value = (hasSolos ? !soloedTracksRef.current.has(id) : mutedTracksRef.current.has(id)) ? 0 : 1
      }
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
    })
    gainsRef.current = newGains
    startRef.current = audioCtxPlayTime - offset
    offsetRef.current = offset
    if (tracksOverride) {
      midiTracksRef.current = tracksOverride.filter(t => t.file_type === 'midi')
    } else {
      midiTracksRef.current = tracksRef.current.filter(t => t.file_type === 'midi')
    }
    scheduleMidiNotes(offset, audioCtxPlayTime).catch(console.warn)
    setPlaying(true)
    const dur = getTransportDuration() || 1
    const tick = () => {
      const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
      if (elapsed >= dur) { setPlaying(false); setCurrentTime(0); offsetRef.current = 0; return }
      setCurrentTime(elapsed)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [getTransportDuration, stopSources, scheduleMidiNotes, ensurePlaybackGraph, ensureMetronomeBuffer])

  const pause = useCallback(() => {
    if (isCountingRef.current) {
      isCountingRef.current = false
      setIsCounting(false)
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      return
    }
    offsetRef.current = (actxRef.current?.currentTime ?? 0) - startRef.current
    stopSources(); setPlaying(false)
  }, [stopSources])

  const seek = useCallback((t: number, tracksOverride?: Track[]) => {
    offsetRef.current = t
    if (playing) play(t, tracksOverride)
    else setCurrentTime(t)
  }, [playing, play])

  const toggleMute = useCallback((id: string) => {
    const next = new Set(mutedTracksRef.current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    mutedTracksRef.current = next
    setMutedTracks(next)

    const g = gainsRef.current.get(id)
    if (g) g.gain.value = next.has(id) ? 0 : 1

    // Reschedule MIDI notes when muting/unmuting during playback
    if (playingRef.current) {
      midiScheduledRef.current.forEach(n => { try { n.stop() } catch { /* ok */ } })
      midiScheduledRef.current = []
      const ctx = actxRef.current
      if (ctx) {
        const elapsed = ctx.currentTime - startRef.current
        scheduleMidiNotes(elapsed, ctx.currentTime).catch(console.warn)
      }
    }
  }, [scheduleMidiNotes])

  const toggleSolo = useCallback((id: string) => {
    const next = new Set(soloedTracksRef.current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    soloedTracksRef.current = next
    setSoloedTracks(next)

    // Soloing one track affects ALL gain nodes — update them all at once.
    const hasSolos = next.size > 0
    gainsRef.current.forEach((g, trackId) => {
      g.gain.value = (hasSolos ? !next.has(trackId) : mutedTracksRef.current.has(trackId)) ? 0 : 1
    })

    // Reschedule MIDI notes while playing so solo state takes effect immediately.
    if (playingRef.current) {
      midiScheduledRef.current.forEach(n => { try { n.stop() } catch { /* ok */ } })
      midiScheduledRef.current = []
      const ctx = actxRef.current
      if (ctx) {
        const elapsed = ctx.currentTime - startRef.current
        scheduleMidiNotes(elapsed, ctx.currentTime).catch(console.warn)
      }
    }
  }, [scheduleMidiNotes])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    if (masterGainRef.current) masterGainRef.current.gain.value = v
    if (typeof window !== 'undefined') localStorage.setItem('trackbase_volume', String(v))
  }, [])

  const toggleMetronome = useCallback(() => {
    const next = !metronomeOnRef.current
    metronomeOnRef.current = next
    setMetronomeOn(next)
    const nextMuted = new Set(mutedTracksRef.current)
    if (next) nextMuted.delete(METRONOME_TRACK_ID)
    else nextMuted.add(METRONOME_TRACK_ID)
    mutedTracksRef.current = nextMuted
    setMutedTracks(nextMuted)
    const g = gainsRef.current.get(METRONOME_TRACK_ID)
    if (g) g.gain.value = next ? 1 : 0
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
    setCurrentTime(snapped)
    return snapped
  }, [])

  const playWithCountIn = useCallback(async (offset = offsetRef.current, tracksOverride?: Track[]) => {
    if (audioTracks.length > 0 && loaded < audioTracks.length) return
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
  }, [play, ensurePlaybackGraph, loaded, audioTracks.length, snapPlayheadToBar])

  return {
    playing, currentTime,
    duration: getTransportDuration(),
    loaded, total: audioTracks.length,
    mutedTracks, soloedTracks, volume, setVolume,
    play: () => playWithCountIn(),
    playTransport: (scheduledStartTime?: number) => {
      if (audioTracks.length > 0 && loaded < audioTracks.length) return
      const snapped = snapPlayheadToBar(offsetRef.current)
      return play(snapped, undefined, scheduledStartTime)
    },
    prepareTransport,
    playWithCountIn,
    pause, seek, toggleMute, toggleSolo,
    metronomeOn, countdownOn, isCounting, toggleMetronome, toggleCountdown,
    audioContext: actxRef, trackDurations,
  }
}

// ─── Track letter buttons ─────────────────────────────────────────────────────

function TrackLetterBtn({
  letter, tooltip, active, onClick, activeClass,
}: {
  letter: string
  tooltip: string
  active?: boolean
  onClick?: () => void
  activeClass?: string
}) {
  return (
    <HoverTooltip label={tooltip}>
      <button
        type="button"
        onClick={onClick}
        className={`size-5 border text-[9px] font-medium grid place-items-center transition uppercase ${
          active && activeClass ? activeClass : 'border-border hover:border-ember hover:text-ember text-muted-foreground'
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
      : 'border-border text-muted-foreground hover:border-ember hover:text-ember hover:bg-ember-soft'
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
      : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
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

// ─── Icon picker popover ──────────────────────────────────────────────────────

const ICON_EMOJIS = ['🥁','🎸','🎹','🎤','🎵','🎷','🎺','🎻','🪗','🎙','🔊','✨']

function IconPicker({ trackId, initialEmoji, initialColor, onApply, onClose }: {
  trackId: string
  initialEmoji: string | null
  initialColor: string | null
  onApply: (emoji: string, color: string) => void
  onClose: () => void
}) {
  const { resolvedTheme } = useTheme()
  const { palette: colorPalette } = usePalette()
  const isDark = resolvedTheme !== 'light'
  const iconColors = getTrackIconSwatches(colorPalette)
  const [emoji, setEmoji] = useState(initialEmoji ?? '🎵')
  const [color, setColor] = useState(() => resolveTrackIconColor(initialColor))
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
        body: JSON.stringify({ icon_emoji: emoji, icon_color: color }),
      })
      onApply(emoji, color)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '100%', left: 0, zIndex: 50,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: 14, width: 240,
        boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        marginTop: 4,
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Emoji grid */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>Instrument</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 12 }}>
        {ICON_EMOJIS.map(e => (
          <button key={e} onClick={() => setEmoji(e)} style={{
            width: 36, height: 36, borderRadius: 7, fontSize: 18,
            background: emoji === e ? `color-mix(in srgb, var(--accent) 10%, transparent)` : 'transparent',
            border: `0.5px solid ${emoji === e ? 'var(--accent)' : 'transparent'}`,
            cursor: 'pointer', transition: 'all 0.12s',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
            onMouseEnter={e2 => { if (emoji !== e) e2.currentTarget.style.background = 'var(--bg-card)' }}
            onMouseLeave={e2 => { if (emoji !== e) e2.currentTarget.style.background = 'transparent' }}
          >{e}</button>
        ))}
      </div>

      {/* Color row */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', margin: '0 0 8px' }}>Color</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {iconColors.map(c => (
          <button key={c} onClick={() => setColor(c)} style={{
            width: 22, height: 22, borderRadius: '50%', background: resolveTrackIconColor(c, isDark),
            border: `2px solid ${color === c ? 'var(--accent)' : 'transparent'}`,
            cursor: 'pointer', flexShrink: 0,
            transform: color === c ? 'scale(1.1)' : 'scale(1)',
            transition: 'transform 0.12s, border-color 0.12s',
          }}
            onMouseEnter={e2 => { if (color !== c) e2.currentTarget.style.transform = 'scale(1.15)' }}
            onMouseLeave={e2 => { if (color !== c) e2.currentTarget.style.transform = 'scale(1)' }}
          />
        ))}
      </div>

      {/* Preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: resolveTrackIconColor(color, isDark), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{emoji}</div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Preview</span>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{
          background: 'transparent', border: '0.5px solid var(--border)',
          borderRadius: 6, padding: '4px 12px', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={handleApply} disabled={saving} style={{
          background: 'var(--accent)', border: 'none',
          borderRadius: 6, padding: '4px 12px', color: 'var(--on-accent)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? '…' : 'Apply'}</button>
      </div>
    </div>
  )
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────

function TrackRow({
  track, index, muted, soloed, changed, currentTimeMs,
  commentMode, activeInput, audioReady,
  onToggleMute, onToggleSolo, onReplace,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput,
  onDeleteTrack, onRenameTrack, onIconUpdate, onMidiDataUpdate, onStartBarUpdate,
  onDragStartOffset, onDragEndOffset, otherTrackDragging,
  currentUserId, isOwner, onReplyCreate, currentUser,
  projectId, versionId, project, totalBars, runtimeDurationMs,
  compact = false,
}: {
  track: Track; index: number; muted: boolean; soloed: boolean; changed: boolean
  currentTimeMs: number; commentMode: boolean
  activeInput: ActiveCommentInput | null; audioReady: boolean
  onToggleMute: () => void; onToggleSolo: () => void; onReplace: (f: File) => void
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onDeleteTrack: (trackId: string) => Promise<void>
  onRenameTrack: (trackId: string, newName: string) => void
  onIconUpdate: (trackId: string, emoji: string, color: string) => void
  onMidiDataUpdate: (trackId: string, updates: Partial<Track>) => void
  onStartBarUpdate: (trackId: string, startBar: number) => Promise<void>
  onDragStartOffset: () => void
  onDragEndOffset: () => void
  otherTrackDragging: boolean
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUser: { username: string } | null
  projectId: string
  versionId: string
  project: Project
  totalBars: number
  runtimeDurationMs: number
  compact?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const { palette: colorPalette } = usePalette()
  const isDark = resolvedTheme !== 'light'
  const fileRef = useRef<HTMLInputElement>(null)
  const col = trackColorAt(index, colorPalette, isDark)
  const isMidi = track.file_type === 'midi'

  // All state/refs must come before computed values that read state
  const [waveformReady, setWaveformReady] = useState(false)
  useEffect(() => { setWaveformReady(false) }, [track.id])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [rowHovered, setRowHovered] = useState(false)
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [pianoRollOpen, setPianoRollOpen] = useState(false)
  // Drag-to-offset state
  const [isOffsetDragging, setIsOffsetDragging] = useState(false)
  const [dragPreviewBar, setDragPreviewBar] = useState<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragMovedRef = useRef(false)
  const origStartBarRef = useRef(0)
  const dragPreviewBarRef = useRef<number | null>(null)
  const waveformColRef = useRef<HTMLDivElement>(null)
  const commentUiActiveRef = useRef(false)
  const activeCommentInteractionsRef = useRef(new Set<string>())

  const handleCommentInteractionChange = useCallback((commentId: string, active: boolean) => {
    if (active) activeCommentInteractionsRef.current.add(commentId)
    else activeCommentInteractionsRef.current.delete(commentId)
    commentUiActiveRef.current = activeCommentInteractionsRef.current.size > 0
  }, [])

  function cancelOffsetDrag() {
    setIsOffsetDragging(false)
    onDragEndOffset()
    dragPreviewBarRef.current = null
    setDragPreviewBar(null)
    dragMovedRef.current = false
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
  // Playhead position relative to this track's content
  const trackLocalTimeMs = Math.max(0, currentTimeMs - trackOffsetMs)
  const trackPlayedRatio = trackOwnDurationMs > 0
    ? Math.min(1, trackLocalTimeMs / trackOwnDurationMs)
    : 0
  // Waveform column layout
  const startPercent = totalBars > 0 ? (effectiveStartBar / totalBars) * 100 : 0
  const widthPercent = totalBars > 0 ? Math.max(1, (trackDurationBars / totalBars) * 100) : 100
  // Scale bar count so each bar stays ~12px wide regardless of clip length.
  // e.g. a 2-bar clip in a 32-bar timeline → 6 bars instead of 96, so they're visible.
  const displayBarCount = totalBars > 0
    ? Math.max(4, Math.round(96 * trackDurationBars / totalBars))
    : 96
  const isAudioLoading = !isMidi && !waveformReady
  // Only expand to fill the remaining timeline while loading if we don't yet know the
  // clip's duration — prevents a flash-to-full-width when duration_ms is already stored.
  const layoutWidthPercent = isAudioLoading && !durationKnown
    ? Math.max(widthPercent, 100 - startPercent)
    : widthPercent

  function barFromClientX(clientX: number): number {
    const colEl = waveformColRef.current
    if (!colEl || totalBars <= 0) return 0
    const rect = colEl.getBoundingClientRect()
    const xPct = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(totalBars - 1, Math.floor(xPct * totalBars)))
  }

  async function snapStartBar(startBar: number) {
    if (startBar === (track.start_bar ?? 0)) return
    try {
      await onStartBarUpdate(track.id, startBar)
    } catch { /* ignore */ }
  }

  // Drag-to-offset handlers (mouse + touch)
  function startOffsetDrag(clientX: number) {
    if (commentMode || commentUiActiveRef.current) return
    dragStartXRef.current = clientX
    dragMovedRef.current = false
    origStartBarRef.current = track.start_bar ?? 0
    const initialBar = track.start_bar ?? 0
    setIsOffsetDragging(true)
    dragPreviewBarRef.current = initialBar
    setDragPreviewBar(initialBar)
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
    function moveAt(clientX: number) {
      const colEl = waveformColRef.current
      if (!colEl) return
      const containerWidth = colEl.offsetWidth
      const barsPerPixel = totalBars / containerWidth
      const deltaX = clientX - dragStartXRef.current
      if (Math.abs(deltaX) > 3) dragMovedRef.current = true
      const newStartBar = Math.max(0, Math.round(origStartBarRef.current + deltaX * barsPerPixel))
      dragPreviewBarRef.current = newStartBar
      setDragPreviewBar(newStartBar)
    }
    function onMouseMove(e: MouseEvent) { moveAt(e.clientX) }
    function onTouchMove(e: TouchEvent) { e.preventDefault(); moveAt(e.touches[0].clientX) }
    async function onDragEnd(e: MouseEvent | TouchEvent) {
      const endTarget = 'changedTouches' in e
        ? e.changedTouches[0]?.target ?? null
        : e.target

      if (isCommentUiTarget(endTarget) || commentUiActiveRef.current) {
        cancelOffsetDrag()
        return
      }

      setIsOffsetDragging(false)
      onDragEndOffset()
      let newBar = dragPreviewBarRef.current
      if (!dragMovedRef.current) {
        newBar = barFromClientX('changedTouches' in e
          ? e.changedTouches[0]?.clientX ?? dragStartXRef.current
          : e.clientX)
        dragPreviewBarRef.current = newBar
        setDragPreviewBar(newBar)
      }
      dragPreviewBarRef.current = null
      if (newBar !== null && newBar !== (track.start_bar ?? 0)) {
        await snapStartBar(newBar)
      }
      setDragPreviewBar(null)
    }
    function onMouseUp(e: MouseEvent) { void onDragEnd(e) }
    function onTouchEnd(e: TouchEvent) { void onDragEnd(e) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffsetDragging, dragPreviewBar, totalBars])

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
  const rowOpacity = otherTrackDragging ? 0.5 : 1

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
      data-track-row
      className="flex group/track hover:bg-surface/30 overflow-visible border-b border-border"
      style={{
        minHeight: rowH,
        background: rowBg,
        boxShadow: isOffsetDragging
          ? '0 2px 8px rgba(0,0,0,0.15)'
          : confirmDelete || deleteError
          ? 'inset 0 0 0 0.5px rgba(239,68,68,0.2)'
          : 'none',
        borderBottom: pianoRollOpen ? 'none' : undefined,
        transition: 'background 0.15s, box-shadow 0.15s, opacity 0.15s',
        opacity: rowOpacity,
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
    >
      {/* Label column */}
      <div
        className={`shrink-0 border-r border-border flex flex-col justify-between ${compact ? 'p-2' : 'p-3'}`}
        style={{ width: compact ? 140 : TRACK_LABEL_W }}
      >
        <div className="flex items-start gap-2 min-w-0">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowIconPicker(p => !p)}
              title="Change track color"
              className={`grid place-items-center font-bold text-background transition-opacity hover:opacity-80 ${compact ? 'size-5 text-[9px]' : 'size-6 text-[10px]'}`}
              style={{ background: col.fg }}
            >
              {!isMidi && !waveformReady ? (
                <span className="animate-pulse opacity-60">·</span>
              ) : trackLetter}
            </button>
            {showIconPicker && (
              <IconPicker
                trackId={track.id}
                initialEmoji={track.icon_emoji}
                initialColor={track.icon_color}
                onApply={(e, c) => { onIconUpdate(track.id, e, c); setShowIconPicker(false) }}
                onClose={() => setShowIconPicker(false)}
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
                className="w-full bg-background border border-ember px-1.5 py-0.5 text-xs uppercase outline-none"
              />
            ) : (
              <div className="flex items-center gap-1 min-w-0" onDoubleClick={startEdit}>
                <div
                  className={`text-xs font-bold uppercase tracking-tight truncate transition-colors ${
                    nameFlash ? 'text-ember' : 'text-foreground'
                  }`}
                >
                  {displayName}
                </div>
                {isMidi && (
                  <span className="text-[8px] uppercase tracking-widest text-ember border border-ember/40 px-1 shrink-0">
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
                  {track.midi_data.notes.length} notes · {trackDurationBars} bars
                  {(track.start_bar ?? 0) > 0 ? ` · bar ${(track.start_bar ?? 0) + 1}` : ''}
                </span>
              ) : (
                <span className="text-[9px] text-muted-foreground truncate block font-mono">
                  {track.original_filename ?? '—'}
                  {track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
                  {(track.start_bar ?? 0) > 0 ? ` · bar ${(track.start_bar ?? 0) + 1}` : ''}
                </span>
              )}
            </div>
            )}
          </div>
        </div>
        <div className={`flex items-center gap-1 ${compact ? 'mt-1' : 'mt-2'}`}>
          <TrackLetterBtn
            letter="M"
            tooltip="Mute"
            active={muted}
            activeClass="bg-ember text-white border-ember"
            onClick={onToggleMute}
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
              className="text-[9px] uppercase tracking-widest border border-border text-muted-foreground hover:border-ember hover:text-ember px-1.5 py-0.5 transition"
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
                  className="h-5 px-1.5 border border-border text-[9px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember transition"
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
        style={{ minHeight: rowH }}
      >
        {!commentMode && (
          <TactGrid
            totalBars={totalBars}
            interactive
            onTactClick={bar => { void snapStartBar(bar) }}
          />
        )}

        <div
          style={{
            position: 'absolute',
            left: `${startPercent}%`,
            width: `${layoutWidthPercent}%`,
            height: '100%',
            cursor: isOffsetDragging ? 'grabbing' : commentMode ? 'inherit' : 'grab',
            borderLeft: effectiveStartBar > 0 ? '1px solid var(--border)' : 'none',
            zIndex: 1,
            transition: isOffsetDragging ? 'none' : 'width 0.25s ease-out',
            touchAction: commentMode ? 'auto' : 'none',
          }}
          onMouseDown={commentMode ? undefined : handleOffsetMouseDown}
          onTouchStart={commentMode ? undefined : handleOffsetTouchStart}
        >
          {isMidi ? (
            track.midi_data ? (
              <div className="w-full h-full" style={{ opacity: muted ? 0.35 : 1 }}>
                <MiniPianoRoll
                  midiData={track.midi_data}
                  color={col.fg}
                  projectBpm={project.bpm ?? undefined}
                  totalProjectMs={trackOwnDurationMs}
                  height={rowH}
                  midiStartBar={0}
                />
              </div>
            ) : (
              <div className="w-full h-full grid place-items-center bg-surface-2">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Loading…</span>
              </div>
            )
          ) : (
            <Waveform
              trackId={track.id} muted={muted} playedRatio={trackPlayedRatio} color={col.fg}
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
              onReady={() => setWaveformReady(true)}
              currentUserId={currentUserId} isOwner={isOwner} onReplyCreate={onReplyCreate}
              currentUser={currentUser}
              onCommentInteractionChange={handleCommentInteractionChange}
              compact={compact}
            />
          )}
        </div>

        {isOffsetDragging && dragPreviewBar !== null && (() => {
          const snapPct = totalBars > 0 ? (dragPreviewBar / totalBars) * 100 : 0
          return (
            <>
              <div className="absolute top-0 h-full w-px bg-ember z-10 pointer-events-none" style={{ left: `${snapPct}%` }} />
              <div
                className="absolute top-0.5 z-10 pointer-events-none bg-ember text-white text-[10px] px-1.5 py-0.5 whitespace-nowrap"
                style={{ left: `${snapPct}%`, transform: 'translateX(-50%)' }}
              >
                Bar {dragPreviewBar + 1}
              </div>
            </>
          )
        })()}
      </div>

      <input ref={fileRef} type="file"
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = '' }}
      />
    </div>

    {/* Piano roll editor — inline expandable panel */}
    <div style={{
      maxHeight: pianoRollOpen ? 500 : 0,
      overflow: 'hidden',
      transition: 'max-height 0.3s ease',
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
          onClose={() => setPianoRollOpen(false)}
          onSaved={(updates) => {
            onMidiDataUpdate(track.id, updates)
            setPianoRollOpen(false)
          }}
        />
      )}
    </div>
    </>
  )
}

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

function MasterPlayerBar({
  playing, currentTime, duration, loaded, total, volume,
  onPlay, onPause, onSeek, onVolume,
  metronomeOn, countdownOn, isCounting,
  onToggleMetronome, onToggleCountdown,
  compact = false,
}: {
  playing: boolean; currentTime: number; duration: number; loaded: number; total: number; volume: number
  onPlay: () => void; onPause: () => void; onSeek: (t: number) => void; onVolume: (v: number) => void
  metronomeOn: boolean; countdownOn: boolean; isCounting: boolean
  onToggleMetronome: () => void; onToggleCountdown: () => void
  compact?: boolean
}) {
  const pct = duration > 0 ? currentTime / duration : 0
  const [dragging, setDragging] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const isLoading = loaded < total && total > 0

  function TransportToggle({
    label, active, onClick, title,
  }: { label: string; active: boolean; onClick: () => void; title: string }) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`h-7 px-2 border text-[9px] font-bold uppercase tracking-widest transition ${
          active
            ? 'border-ember bg-ember text-white'
            : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
        }`}
      >
        {label}
      </button>
    )
  }

  const transportToggles = (
    <div className="flex items-center gap-1.5 shrink-0">
      <TransportToggle
        label="Metro"
        active={metronomeOn}
        onClick={onToggleMetronome}
        title="Metronome click track"
      />
      <TransportToggle
        label="CD"
        active={countdownOn}
        onClick={onToggleCountdown}
        title="One-bar count-in before play"
      />
      {isCounting && (
        <span className="text-[9px] uppercase tracking-widest text-amber shrink-0">Count-in…</span>
      )}
    </div>
  )

  function posToTime(clientX: number) {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }

  function onBarPointer(clientX: number) {
    onSeek(posToTime(clientX))
  }

  if (compact) {
    return (
      <div className="border-t border-border bg-surface/60 px-3 flex items-center gap-2 shrink-0 h-10">
        {transportToggles}
        <button
          type="button"
          onClick={(playing || isCounting) ? onPause : onPlay}
          disabled={duration <= 0 || isLoading}
          className="size-10 bg-ember text-white grid place-items-center hover:brightness-110 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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
          className="flex-1 min-w-0 h-1 bg-surface-2 relative cursor-pointer select-none"
          onMouseDown={e => { setDragging(true); onBarPointer(e.clientX) }}
          onMouseMove={e => { if (dragging) onBarPointer(e.clientX) }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
          onTouchStart={e => { setDragging(true); onBarPointer(e.touches[0].clientX) }}
          onTouchMove={e => { if (dragging) onBarPointer(e.touches[0].clientX) }}
          onTouchEnd={() => setDragging(false)}
        >
          <div className="absolute inset-y-0 left-0 bg-ember" style={{ width: `${pct * 100}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${pct * 100}%` }} />
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
          className="size-10 bg-ember text-white grid place-items-center hover:brightness-110 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
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
        className="flex-1 min-w-[200px] h-2 bg-surface-2 relative cursor-pointer select-none"
        onMouseDown={e => { setDragging(true); onBarPointer(e.clientX) }}
        onMouseMove={e => { if (dragging) onBarPointer(e.clientX) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        <div className="absolute inset-y-0 left-0 bg-ember" style={{ width: `${pct * 100}%` }} />
        <div className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${pct * 100}%` }} />
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
          className="w-24 accent-ember"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums w-8">{Math.round(volume * 100)}</span>
      </div>
    </div>
  )
}

// ─── Format bytes helper ──────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ─── Mobile version bar (scrollable pills + fixed + branch) ───────────────────

function MobileVersionBar({
  versions, activeId, onSelect, onNewBranch,
}: {
  versions: Version[]
  activeId: string
  onSelect: (id: string) => void
  onNewBranch: () => void
}) {
  return (
    <div className="flex items-stretch border-b border-border bg-surface/40 shrink-0 h-9">
      <div className="flex-1 min-w-0 overflow-x-auto flex items-center gap-1.5 px-3 scrollbar-none">
        {versions.map(v => {
          const isActive = v.id === activeId
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              className={`shrink-0 text-[10px] uppercase tracking-widest px-2 py-1 border transition ${
                isActive
                  ? 'bg-ember text-white border-ember'
                  : v.merged_at
                    ? 'border-border text-muted-foreground opacity-50'
                    : 'border-border hover:border-ember hover:text-ember text-muted-foreground'
              }`}
            >
              {isActive && v.type === 'main' && '● '}
              {v.merged_at && '✓ '}
              {v.type === 'branch' && !v.merged_at && !isActive && '⌥ '}
              {v.name}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onNewBranch}
        className="shrink-0 self-stretch border-l border-border px-3 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember hover:bg-surface/60 transition"
      >
        + Branch
      </button>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ versions, activeId, onSelect, onNewBranch, onMerge, mergeCheckingId, storageUsed, storageLimit, commentCounts, projectId, projectName, isOpen, compact = false }: {
  versions: Version[]; activeId: string
  onSelect: (id: string) => void; onNewBranch: () => void; onMerge: (id: string) => void
  mergeCheckingId: string | null
  storageUsed: number
  storageLimit: number
  commentCounts: Record<string, number>
  projectId: string
  projectName: string
  isOpen?: boolean
  compact?: boolean
}) {
  const main = versions.find(v => v.type === 'main')
  const branches = versions.filter(v => v.type === 'branch')
  const active = versions.find(v => v.id === activeId)
  const canMerge = active?.type === 'branch' && !active.merged_at

  const staticActions: { label: string; icon: React.ReactNode; action: () => void }[] = [
    {
      label: '+ New branch',
      icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" /><path d="M3 4.5V7.5M3 4.5C3 7 6 7 6 9H7.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>,
      action: onNewBranch,
    },
  ]

  const isChecking = mergeCheckingId === activeId
  const storagePct = Math.min(100, (storageUsed / storageLimit) * 100)

  return (
    <aside
      data-tour="versions-sidebar"
      className={`project-mixer-sidebar w-[200px] shrink-0 flex flex-col overflow-hidden border-r border-border ${
        compact ? 'bg-surface' : 'bg-surface/30'
      }${isOpen ? ' sidebar-open' : ''}`}
    >
      <div className={`flex-1 overflow-y-auto flex flex-col ${compact ? 'p-3 gap-4' : 'p-4 gap-6'}`}>
        <div>
          <SectionLabel>VERSION HISTORY</SectionLabel>
          <div className={compact ? 'mt-2 space-y-1' : 'mt-4 space-y-3'}>
            {[main, ...branches].filter(Boolean).map(v => {
              const isActive = v!.id === activeId
              const comments = commentCounts[v!.id] ?? 0
              return (
                <button
                  key={v!.id}
                  type="button"
                  onClick={() => onSelect(v!.id)}
                  className={`relative w-full text-left pl-4 border-l-2 transition-colors ${
                    isActive ? 'border-ember' : 'border-border hover:border-muted-foreground'
                  }`}
                >
                  <div
                    className={`absolute -left-[5px] size-2 rounded-full ${
                      compact ? 'top-1/2 -translate-y-1/2' : 'top-1'
                    } ${isActive ? 'bg-ember' : v!.merged_at ? 'bg-online' : 'bg-muted-foreground'}`}
                  />
                  {compact ? (
                    <div className="text-[10px] truncate leading-tight py-1">
                      <span className="font-bold text-foreground">{v!.name}</span>
                      <span className="text-muted-foreground font-normal">
                        {' · '}{fmtDate(v!.created_at)}
                        {comments > 0 && ` · ${comments} comment${comments !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="text-[11px] font-bold truncate text-foreground">{v!.name}</div>
                      <div className="text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5">
                        {fmtDate(v!.created_at)}
                        {comments > 0 && ` · ${comments} COMMENTS`}
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <SectionLabel>ACTIONS</SectionLabel>
          <div className="mt-3 space-y-1">
            {canMerge && (
              <button
                type="button"
                onClick={() => !isChecking && onMerge(activeId)}
                disabled={isChecking}
                className="w-full text-left border border-ember/50 text-ember bg-ember-soft py-2 px-3 uppercase tracking-widest text-[10px] hover:bg-ember/20 transition disabled:opacity-50"
              >
                {isChecking ? 'Checking…' : 'Merge to main →'}
              </button>
            )}
            {staticActions.map(({ label, icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                data-tour="new-branch-button"
                className="w-full text-left border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember transition flex items-center gap-2"
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={compact ? '' : 'mt-auto'}>
          <SectionLabel>STORAGE</SectionLabel>
          {compact ? (
            <div className="text-[10px] tabular-nums mt-1 text-muted-foreground truncate">
              {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
              <span className={`ml-2 ${storagePct > 95 ? 'text-destructive' : 'text-ember'}`}>
                {Math.round(storagePct)}%
              </span>
            </div>
          ) : (
            <>
              <div className="text-[10px] tabular-nums mt-2 text-muted-foreground">
                {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
              </div>
              <div className="h-1 bg-surface-2 mt-1 overflow-hidden">
                <div
                  className={`h-full transition-all ${storagePct > 95 ? 'bg-destructive' : 'bg-ember'}`}
                  style={{ width: `${storagePct}%` }}
                />
              </div>
              {storageUsed / storageLimit > 0.95 && (
                <p className="text-[9px] text-destructive mt-1 m-0">Almost full</p>
              )}
            </>
          )}
        </div>
      </div>

      {!compact && (
        <div className="p-4 pt-0 border-t border-border">
          <ProjectResourcesButton projectId={projectId} projectName={projectName} className="mt-4" />
        </div>
      )}
    </aside>
  )
}

// ─── New branch modal ─────────────────────────────────────────────────────────

function NewBranchModal({ onConfirm, onCancel }: { onConfirm: (n: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
        <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">New branch</p>
        <input
          autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel() }}
          placeholder="feature/new-guitar"
          className="w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-ember placeholder:text-muted-foreground/60 mb-4"
        />
        <div className="flex gap-2 justify-end">
          <TbBtn onClick={onCancel}>Cancel</TbBtn>
          <TbBtn variant="primary" onClick={() => name.trim() && onConfirm(name.trim())}>Create</TbBtn>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { bandId, projectId } = useParams<{ bandId: string; projectId: string }>()
  const cache = useVersionCache()
  const { user, profile, updateOnboarding } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()

  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [uploading, setUploading] = useState(false)  // for handleReplaceTrack only
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [commentMode, setCommentMode] = useState(false)
  const [activeCommentInput, setActiveCommentInput] = useState<ActiveCommentInput | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [mergeModal, setMergeModal] = useState<{ branchId: string; preview: MergePreview } | null>(null)
  const [mergeCheckingId, setMergeCheckingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(500 * 1024 * 1024)
  const [shareCopied, setShareCopied] = useState(false)
  const [sections, setSections] = useState<Section[]>([])
  const [editStructure, setEditStructure] = useState(false)
  const [showTour, setShowTour] = useState(false)
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

  // Structure editing is desktop-only — keep mobile mixer light
  useEffect(() => {
    if (isMobileLandscape && editStructure) setEditStructure(false)
  }, [isMobileLandscape, editStructure])

  const [topbarSheetOpen, setTopbarSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const trackListRef = useRef<HTMLDivElement>(null)
  const tracksBodyRef = useRef<HTMLDivElement>(null)
  const [recordingSessions, setRecordingSessions] = useState<{ id: string; name: string }[]>([])
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null)
  const [recordingPreviewEnds, setRecordingPreviewEnds] = useState<Record<string, number>>({})
  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingAddRow, setIsDraggingAddRow] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadsRef = useRef<UploadItem[]>([])
  // Track being dragged (for dimming others)
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

  async function loadProject(keepActiveVersion = true) {
    // Cache hit: if the active version is already cached, skip the full re-fetch
    if (keepActiveVersion && activeVersionId && cache.getVersion(activeVersionId)) {
      console.log('[cache] hit on loadProject, skipping fetch for:', activeVersionId)
      return
    }

    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('Not found')
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

      if (!keepActiveVersion || !activeVersionId) {
        const main = data.versions.find((v: Version) => v.type === 'main')
        setActiveVersionId(main?.id ?? data.versions[0]?.id ?? '')
      }

      fetch(`/api/projects/${projectId}/storage`)
        .then(r => r.json())
        .then(d => { setStorageUsed(d.used_bytes ?? 0); setStorageLimit(d.limit_bytes ?? 500*1024*1024) })
        .catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProject(false) }, [projectId]) // eslint-disable-line

  // Auto-start tour for first-time visitors
  useEffect(() => {
    if (!loading && profile && !profile.onboarding?.project_tour_completed && !profile.onboarding?.project_tour_skipped) {
      // Small delay to let the page settle
      const t = setTimeout(() => setShowTour(true), 400)
      return () => clearTimeout(t)
    }
  }, [loading, profile])

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
  const canSaveVersion = activeVersion?.type === 'branch' && !activeVersion.merged_at
  const isSaveVersionChecking = mergeCheckingId === activeVersionId

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
  const baselineTimelineSec = Math.max(
    16 * ((60000 / (project?.bpm ?? 120)) * (parseInt((project?.time_signature ?? '4/4').split('/')[0]) || 4)) / 1000,
    recordingPreviewEndSec,
    1,
  )

  const player = usePlayer(activeTracks, activeVersionId, project, recordingPreviewEndSec, baselineTimelineSec)
  const playerRef = useRef(player)
  playerRef.current = player
  const activeRecordingIdRef = useRef(activeRecordingId)
  activeRecordingIdRef.current = activeRecordingId
  const recordingStopRef = useRef<(() => void) | null>(null)

  const beginRecordingCountdown = useCallback(async (bpm: number, timeSig: string) => {
    const ctx = getSharedAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    return startCountdown(ctx, getMasterOutput(), bpm, timeSig)
  }, [])

  const getRecordingPlaybackMs = useCallback(() => playerRef.current.currentTime * 1000, [])

  useEffect(() => {
    setRecordingSessions([])
    setActiveRecordingId(null)
    setRecordingPreviewEnds({})
  }, [activeVersionId])

  function handleAddRecordingTrack() {
    if (!activeVersionId) return
    setRecordingSessions(prev => [...prev, { id: crypto.randomUUID(), name: 'New recording' }])
  }

  function handleRecordingArm(id: string) {
    setActiveRecordingId(id)
  }

  function handleRecordingRelease(id: string) {
    setActiveRecordingId(prev => (prev === id ? null : prev))
  }

  async function handleRecordingSaved(id: string, track: Track) {
    setRecordingSessions(prev => prev.filter(s => s.id !== id))
    setActiveRecordingId(prev => (prev === id ? null : prev))
    setVersions(prev => prev.map(v =>
      v.id === activeVersionId ? { ...v, tracks: [...v.tracks, track] } : v
    ))
    cache.invalidate(activeVersionId)
    await loadProject()
  }

  function handleRecordingDelete(id: string) {
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
      const next = { ...prev }
      if (endSec != null && endSec > 0) next[id] = endSec
      else delete next[id]
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
      if (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      ) return

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

  const durationMs = player.duration * 1000
  const projBpm = project?.bpm ?? 120
  const projTimeSig = project?.time_signature ?? '4/4'
  const projBeatsPerBar = parseInt(projTimeSig.split('/')[0]) || 4
  const projBarDurationMs = (60000 / projBpm) * projBeatsPerBar
  // Total bars: max(start_bar + durationBars) across ALL tracks.
  // Duration uses project BPM for all track types (including MIDI).
  function effectiveTrackDurationMs(t: Track): number {
    return trackContentDurationMs(
      t,
      projBpm,
      player.trackDurations.get(t.id),
    )
  }
  const totalProjectBars = activeTracks.length > 0 ? (() => {
    const barDurMs = projBarDurationMs || 2000
    const endBars = activeTracks.map(t => {
      const dMs = effectiveTrackDurationMs(t)
      const bars = Math.ceil((dMs || 0) / barDurMs)
      return (t.start_bar ?? 0) + bars
    })
    return Math.max(...endBars, 16)
  })() : 16
  const totalProjectDurationMs = Math.max(totalProjectBars * projBarDurationMs, durationMs, 1)

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
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.filter(t => t.id !== trackId),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleRenameTrack(trackId: string, newName: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, display_name: newName } : t),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleIconUpdate(trackId: string, emoji: string, color: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, icon_emoji: emoji, icon_color: color } : t),
    })))
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

      updateUpload(upload.id, { status: 'done' })
      cache.invalidate(activeVersionId)
      await loadProject()
      setTimeout(() => removeUpload(upload.id), 1500)

    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
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
      updateUpload(upload.id, { status: 'done' })
      cache.invalidate(activeVersionId)
      await loadProject()
      setTimeout(() => removeUpload(upload.id), 1500)
    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Processing failed',
      })
    }
  }

  function retryUpload(uploadId: string) {
    const upload = uploadsRef.current.find(u => u.id === uploadId)
    if (!upload) return

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

  function handleUploadFiles(files: File[]) {
    if (!files.length || !activeVersionId) return

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
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('name', track.name); fd.append('position', String(track.position))
      const res = await fetch(`/api/versions/${activeVersionId}/tracks/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error((await res.json()).error)
      await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' })
      cache.invalidate(activeVersionId)
      await loadProject()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleNewBranch(name: string) {
    setShowBranchModal(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: activeVersionId }),
      })
      const { version } = await res.json()
      cache.invalidate(activeVersionId)
      await loadProject()
      setActiveVersionId(version.id)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
  }

  async function handleMergeClick(branchId: string) {
    setMergeCheckingId(branchId)
    try {
      const res = await fetch(`/api/projects/${projectId}/merge/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch_id: branchId }),
      })
      if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'Failed to check merge'); return }
      const preview = await res.json()
      console.log('Merge preview:', JSON.stringify(preview, null, 2))
      setMergeModal({ branchId, preview })
    } catch { alert('Network error') }
    finally { setMergeCheckingId(null) }
  }

  async function handleMergeComplete({ tracksUpdated, branchName }: { tracksUpdated: number; branchName: string }) {
    setMergeModal(null)
    cache.invalidate(mergeModal?.branchId ?? '')
    if (mainVersion) cache.invalidate(mainVersion.id)
    await loadProject(false)
    const main = versions.find(v => v.type === 'main')
    setActiveVersionId(main?.id ?? '')
    const msg = `✓ "${branchName}" merged into main — ${tracksUpdated} track${tracksUpdated !== 1 ? 's' : ''} updated`
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

  const commentCounts: Record<string, number> = {}
  for (const v of versions) {
    commentCounts[v.id] = v.tracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)
  }

  async function handleShare() {
    await navigator.clipboard.writeText(window.location.href)
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  useEffect(() => {
    if (!moreOpen) return
    function onDoc(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  const headerActions = (
    <>
      <TbBtn variant="ghost" className="hidden lg:inline-flex" onClick={handleShare} data-tour="share-button">
        {shareCopied ? 'Copied!' : 'Share'}
      </TbBtn>
      <TbBtn
        variant="ghost"
        className="hidden lg:inline-flex"
        disabled={!canSaveVersion || isSaveVersionChecking}
        onClick={() => canSaveVersion && handleMergeClick(activeVersionId)}
        data-tour="save-version-button"
        title={canSaveVersion ? 'Merge this branch into main' : 'Switch to a branch to merge changes into main'}
      >
        {isSaveVersionChecking ? 'Checking…' : 'Save Version'}
      </TbBtn>
      <a
        href={`/api/versions/${activeVersionId}/export`}
        className="hidden sm:inline-flex bg-foreground text-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-ember hover:text-white transition no-underline items-center"
      >
        Export WAV
      </a>
      {isMobileLandscape && (
        <CommentToggleBtn
          active={commentMode}
          count={totalComments}
          onClick={() => { setCommentMode(m => !m); setActiveCommentInput(null) }}
        />
      )}
      <div className="relative" ref={moreRef}>
        <button
          type="button"
          onClick={() => setMoreOpen(o => !o)}
          aria-label="More actions"
          className="size-8 border border-border bg-surface-2 grid place-items-center text-xs hover:border-ember hover:text-ember transition"
        >
          ⋯
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 z-50 border border-border bg-popover shadow-2xl text-[11px]">
            <button type="button" onClick={() => { setMoreOpen(false); setShowTour(true) }} className="w-full text-left px-3 py-2 hover:bg-surface flex items-center justify-between">
              <span>Restart tour</span><span className="text-ember">?</span>
            </button>
            <button type="button" onClick={() => { handleShare(); setMoreOpen(false) }} className="w-full text-left px-3 py-2 hover:bg-surface lg:hidden">Share</button>
            <button type="button" onClick={() => { if (canSaveVersion) handleMergeClick(activeVersionId); setMoreOpen(false) }} className="w-full text-left px-3 py-2 hover:bg-surface lg:hidden" disabled={!canSaveVersion}>Save Version</button>
            <a href={`/api/versions/${activeVersionId}/export`} className="block w-full text-left px-3 py-2 hover:bg-surface sm:hidden">Export WAV</a>
            <button type="button" onClick={() => { setMoreOpen(false); setSidebarOpen(o => !o) }} className="w-full text-left px-3 py-2 hover:bg-surface lg:hidden">
              {sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            </button>
          </div>
        )}
      </div>
    </>
  )

  if (loading) return <BrandSpinner />
  if (error || !project) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-danger">{error || 'Project not found'}</div>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">

      {/* Reading mode — full portrait mobile experience */}
      <ReadingMode
        project={project}
        player={{
          playing: player.playing,
          currentTime: player.currentTime,
          duration: player.duration,
          loaded: player.loaded,
          total: player.total,
          play: player.play,
          pause: player.pause,
          seek: player.seek,
        }}
        sections={sections}
        versions={versions}
        activeVersionId={activeVersionId}
        onVersionChange={id => { setActiveVersionId(id); setCommentMode(false); setActiveCommentInput(null) }}
        projectId={projectId}
        bandId={bandId}
        activeTracks={activeTracks}
        barDurationMs={projBarDurationMs}
        visible={isMobilePortrait}
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
          <span className="text-[11px] truncate flex-1 text-muted-foreground uppercase tracking-widest">{project.name}</span>
          <CommentToggleBtn
            active={commentMode}
            count={totalComments}
            onClick={() => { setCommentMode(m => !m); setActiveCommentInput(null) }}
            className="size-7"
          />
          <button
            type="button"
            onClick={() => setTopbarSheetOpen(true)}
            aria-label="More actions"
            className="size-7 border border-border grid place-items-center text-muted-foreground hover:border-ember hover:text-ember bg-transparent cursor-pointer"
          >
            ⋯
          </button>
        </header>
      ) : (
        <AppHeader
          left={
            <button
              type="button"
              className="project-sidebar-toggle lg:hidden size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition shrink-0"
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
            <>
              <Link href={`/band/${bandId}`} className="hover:text-foreground no-underline text-muted-foreground">
                {project.band_name ?? 'Band'}
              </Link>
              <span className="text-border">/</span>
              <span className="text-foreground truncate">{project.name}</span>
            </>
          }
          right={headerActions}
        />
      )}

      {isMobileLandscape && (
        <MobileVersionBar
          versions={versions}
          activeId={activeVersionId}
          onSelect={id => { setActiveVersionId(id); setCommentMode(false); setActiveCommentInput(null) }}
          onNewBranch={() => setShowBranchModal(true)}
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
            <a href={`/api/versions/${activeVersionId}/export`} style={sheetBtnStyle} onClick={() => setTopbarSheetOpen(false)}>
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

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Backdrop — only visible on tablet/mobile when sidebar is open */}
        <div
          className={`sidebar-backdrop${sidebarOpen ? ' sidebar-open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
        <Sidebar
          versions={versions} activeId={activeVersionId}
          onSelect={id => { setActiveVersionId(id); setCommentMode(false); setActiveCommentInput(null); if (window.innerWidth < 1024) setSidebarOpen(false) }}
          onNewBranch={() => setShowBranchModal(true)}
          onMerge={handleMergeClick}
          mergeCheckingId={mergeCheckingId}
          storageUsed={storageUsed}
          storageLimit={storageLimit}
          commentCounts={commentCounts}
          projectId={projectId}
          projectName={project.name}
          isOpen={sidebarOpen}
          compact={isMobileLandscape}
        />

        <main
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background relative"
          onDragOver={handleContentDragOver}
          onDragLeave={handleContentDragLeave}
          onDrop={handleContentDrop}
        >
          {/* Full-screen drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-[200] pointer-events-none border-2 border-dashed border-ember bg-ember-soft/50 flex flex-col items-center justify-center gap-2">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-ember">
                <path d="M16 4v16M8 14l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 26h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-sm font-medium text-ember uppercase tracking-widest">Drop files to add tracks</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">WAV · MP3 · MIDI</span>
            </div>
          )}

          {/* Content — dimmed while dragging */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', opacity: isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}>

          {/* Project header */}
          {isMobileLandscape ? (
            <section className="border-b border-border bg-surface/40 shrink-0 px-4 py-1.5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums flex items-center gap-x-3 overflow-x-auto whitespace-nowrap scrollbar-none">
                {project.bpm != null && <span>{project.bpm} BPM</span>}
                {project.key && <span className="text-ember">{project.key}</span>}
                <span>{project.time_signature ?? '4/4'}</span>
                <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                {player.duration > 0 && <span>{fmtTime(player.duration)}</span>}
              </div>
            </section>
          ) : (
          <section className="border-b border-border bg-surface/40 shrink-0">
            <div className="px-4 sm:px-6 py-4 flex flex-wrap items-start gap-4 lg:gap-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
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
                      className="font-display text-xl uppercase tracking-tight bg-background border border-ember px-2 py-1 outline-none max-w-full"
                    />
                  ) : (
                    <div className="flex items-center gap-2 group min-w-0" onDoubleClick={startProjectRename}>
                      <h1
                        className={`font-display text-2xl sm:text-3xl uppercase tracking-tighter truncate m-0 transition-colors ${
                          projectNameFlash ? 'text-ember' : 'text-foreground'
                        }`}
                      >
                        {project.name}
                      </h1>
                      <button
                        type="button"
                        onClick={startProjectRename}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-ember bg-transparent border-0 cursor-pointer p-0"
                        title="Rename project"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditStructure(p => !p)}
                    disabled={activeTracks.length === 0}
                    data-tour="edit-structure-button"
                    className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition disabled:opacity-40 ${
                      editStructure || sections.length > 0
                        ? 'border-ember text-ember bg-ember-soft'
                        : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
                    }`}
                  >
                    {editStructure ? 'Done editing' : sections.length > 0 ? 'Edit structure' : '+ Add structure'}
                  </button>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                  {project.bpm != null && <span>{project.bpm} BPM</span>}
                  {project.key && <span className="text-ember">{project.key}</span>}
                  <span>{project.time_signature ?? '4/4'}</span>
                  <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                  {player.duration > 0 && <span>{fmtTime(player.duration)}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap lg:ml-auto">
                <SectionLabel>VERSION</SectionLabel>
                {versions.map(v => {
                  const isActive = v.id === activeVersionId
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { setActiveVersionId(v.id); setCommentMode(false); setActiveCommentInput(null) }}
                      className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition ${
                        isActive
                          ? 'bg-ember text-white border-ember'
                          : v.merged_at
                            ? 'border-border text-muted-foreground opacity-50'
                            : 'border-border hover:border-ember hover:text-ember text-muted-foreground'
                      }`}
                    >
                      {isActive && v.type === 'main' && '● '}
                      {v.merged_at && '✓ '}
                      {v.type === 'branch' && !v.merged_at && !isActive && '⌥ '}
                      {v.name}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setShowBranchModal(true)}
                  className="text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-dashed border-border hover:border-ember hover:text-ember text-muted-foreground transition"
                >
                  + Branch
                </button>
              </div>
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
              onSeek={player.seek}
              compact={isMobileLandscape}
            />
          )}

          {/* Comment mode banner — desktop only; mobile uses top-bar icon */}
          {!isMobileLandscape && (
          <div className={`overflow-hidden transition-[height,opacity] duration-200 shrink-0 ${commentMode ? 'h-9 opacity-100' : 'h-0 opacity-0'}`}>
            <div className="flex items-center gap-2 px-4 sm:px-6 h-9 bg-ember-soft border-b border-ember/30">
              <span className="text-[10px] uppercase tracking-widest text-ember">
                ● Comment mode — click-drag on any waveform to select a time range
              </span>
            </div>
          </div>
          )}

          {/* Track list */}
          <div ref={trackListRef} className="flex-1 overflow-y-auto overflow-x-hidden relative">
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
                    <TactGrid totalBars={totalProjectBars} />
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

              {versionLoading ? (
                <BrandSpinner fullscreen={false} />
              ) : activeTracks.length === 0 ? (
                <div className="px-4 sm:px-6 py-12 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                  No tracks yet — add one below
                </div>
              ) : activeTracks.map((t, i) => (
                <TrackRow
                  key={t.id} track={t} index={i}
                  muted={player.mutedTracks.has(t.id)} soloed={player.soloedTracks.has(t.id)} changed={isChanged(t)}
                  currentTimeMs={player.currentTime * 1000}
                  commentMode={commentMode} activeInput={activeCommentInput}
                  audioReady={player.loaded >= player.total && player.total > 0}
                  onToggleMute={() => player.toggleMute(t.id)}
                  onToggleSolo={() => player.toggleSolo(t.id)}
                  onReplace={f => handleReplaceTrack(t, f)}
                  onCommentPlace={setActiveCommentInput}
                  onCommentDelete={handleCommentDelete}
                  onCommentCreate={handleCommentCreate}
                  onCloseInput={() => setActiveCommentInput(null)}
                  onDeleteTrack={handleDeleteTrack}
                  onRenameTrack={handleRenameTrack}
                  onIconUpdate={handleIconUpdate}
                  onMidiDataUpdate={handleMidiDataUpdate}
                  onStartBarUpdate={handleStartBarUpdate}
                  onDragStartOffset={() => setDraggingTrackId(t.id)}
                  onDragEndOffset={() => setDraggingTrackId(null)}
                  otherTrackDragging={draggingTrackId !== null && draggingTrackId !== t.id}
                  currentUserId={user?.id}
                  isOwner={isOwner}
                  onReplyCreate={handleReplyCreate}
                  currentUser={currentUser}
                  projectId={projectId}
                  versionId={activeVersionId}
                  project={project}
                  totalBars={totalProjectBars}
                  runtimeDurationMs={effectiveTrackDurationMs(t)}
                  compact={isMobileLandscape}
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
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className={`w-full min-h-[60px] p-4 text-left text-[10px] uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isDraggingAddRow
                        ? 'text-ember bg-ember-soft'
                        : 'text-muted-foreground hover:text-ember hover:bg-surface/30'
                    }`}
                  >
                    {isDraggingAddRow ? '↓ Drop to add track' : '+ Add track'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddRecordingTrack}
                    disabled={!activeVersionId}
                    className="w-full min-h-[48px] px-4 text-left text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ember hover:bg-surface/30 transition disabled:opacity-40 disabled:cursor-not-allowed border-t border-border flex items-center gap-2"
                  >
                    <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
                    Record track
                  </button>
                </div>
                <div className="flex-1 min-h-[108px] relative overflow-hidden">
                  <TactGrid totalBars={totalProjectBars} />
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
              <input ref={fileInputRef} type="file"
                accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
                multiple className="hidden" onChange={handleAddTrack}
              />
            </div>
          </div>

          {/* Footer toolbar — BPM meta + comment mode (desktop only) */}
          {!isMobileLandscape && (
          <div className="border-t border-border bg-surface/60 px-4 sm:px-6 py-3 shrink-0 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 flex-wrap min-w-0">
              {project && (
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                />
              )}
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
                {activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}
              </span>
            </div>
            <TbBtn
              variant={commentMode ? 'primary' : 'ghost'}
              onClick={() => { setCommentMode(m => !m); setActiveCommentInput(null) }}
              data-tour="comments-toggle"
            >
              {commentMode ? '● COMMENT MODE' : `Comment Mode${totalComments > 0 ? ` (${totalComments})` : ''}`}
            </TbBtn>
          </div>
          )}

          </div>{/* end content dim wrapper */}
        </main>
      </div>

      <MasterPlayerBar
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
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
      </>
      )}

      {/* Onboarding tour */}
      <ProjectTour
        projectName={project?.name ?? 'this project'}
        show={showTour}
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
          preview={mergeModal.preview}
          onClose={() => setMergeModal(null)}
          onMerged={handleMergeComplete}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} />}
    </div>
  )
}

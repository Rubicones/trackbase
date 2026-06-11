'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { TrackComment, CommentReply, Track, Version, Project, Section, MidiTrackData } from '@/lib/types'
import { useVersionCache } from '@/hooks/useVersionCache'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { MergeModal } from './MergeModal'
import type { MergePreview } from './MergeModal'
import StructureOverlay, { getBarMath } from '@/components/StructureEditor'
import { waveformBarsCache, audioArrayBufferCache } from '@/lib/waveformCache'
import { resolveTrackIconColor, TRACK_ICON_COLORS } from '@/lib/trackIcon'
import { BrandSpinner } from '@/components/BrandSpinner'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import PianoRollEditor from '@/components/PianoRollEditor'
import { gmProgramLabel, sixteenthDuration, sixteenthsPerBar, gmInstrumentName } from '@/lib/midi'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRACK_PALETTE = [
  { bg: 'rgba(167,139,250,0.12)', bgLight: '#ede9ff', fg: '#a78bfa' },
  { bg: 'rgba(52,211,153,0.12)', bgLight: '#d4eed4', fg: '#34d399' },
  { bg: 'rgba(251,191,36,0.12)', bgLight: '#f5e6c8', fg: '#fbbf24' },
  { bg: 'rgba(248,113,113,0.12)', bgLight: '#fde8e8', fg: '#f87171' },
  { bg: 'rgba(96,165,250,0.12)', bgLight: '#dbeafe', fg: '#60a5fa' },
  { bg: 'rgba(232,121,249,0.12)', bgLight: '#fce7f3', fg: '#e879f9' },
]
const palette = (i: number) => TRACK_PALETTE[i % TRACK_PALETTE.length]

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

function avatarColor(str: string): string {
  const colors = ['#6366F1','#10B981','#F59E0B','#EC4899','#06B6D4','#8B5CF6','#F97316','#14B8A6']
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
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

function CommentTooltip({
  comment, anchorLeft, anchorTop, onDelete, onHide, currentUserId, isOwner, onReplySubmit, onReplyFocusChange,
}: {
  comment: TrackComment
  anchorLeft: number
  anchorTop: number
  onDelete: (id: string) => void
  onHide: () => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplySubmit: (commentId: string, content: string) => Promise<void>
  onReplyFocusChange?: (focused: boolean) => void
}) {
  const W = 260
  let left = anchorLeft - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
  const caretLeft = Math.max(8, Math.min(W - 12, anchorLeft - left))

  const [showAllReplies, setShowAllReplies] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const replies: CommentReply[] = (comment.replies ?? []) as CommentReply[]
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2)
  const hiddenCount = replies.length - 2

  const authorColor = avatarColor(comment.author_username ?? 'unknown')
  const canDelete = comment.created_by === currentUserId || isOwner

  return createPortal(
    <div
      className="fixed z-[6000] pointer-events-auto rounded-xl overflow-hidden"
      style={{
        left, top: anchorTop, width: W, transform: 'translateY(-100%)',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-light)',
      }}
      onMouseLeave={onHide}
    >
      <div className="absolute pointer-events-none" style={{
        bottom: -4, left: caretLeft - 4,
        borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
        borderTop: '4px solid var(--bg-surface)',
      }} />
      <div className="px-3 py-2">
        {/* Top row: author + timecode + delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            background: `${authorColor}33`,
            border: `1px solid ${authorColor}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 600, color: authorColor, flexShrink: 0,
          }}>
            {(comment.author_username ?? 'unknown').slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-sec)', fontWeight: 500 }}>{comment.author_username ?? 'unknown'}</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>·</span>
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--accent)' }}>
            {fmtMs(comment.timecode_start_ms)} → {fmtMs(comment.timecode_end_ms)}
          </span>
          {canDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(comment.id) }}
              className="text-[12px] text-dim hover:text-danger transition-colors duration-150 px-0.5 leading-none"
              style={{ marginLeft: 'auto' }}
            >✕</button>
          )}
        </div>
        {/* Relative time */}
        <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 8px 0' }}>{relativeTime(comment.created_at)}</p>
        {/* Comment text */}
        <p className="text-[13px] text-soft leading-snug break-words" style={{ margin: 0, lineHeight: 1.5 }}>{comment.content}</p>

        {/* Replies */}
        {replies.length > 0 && (
          <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            {visibleReplies.map(r => {
              const rc = avatarColor(r.author_username)
              return (
                <div key={r.id} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: `${rc}33`, border: `1px solid ${rc}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 7, fontWeight: 600, color: rc, flexShrink: 0,
                    }}>
                      {r.author_username.slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-sec)' }}>{r.author_username}</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.4, margin: 0 }}>{r.content}</p>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '2px 0 0 0' }}>{relativeTime(r.created_at)}</p>
                </div>
              )
            })}
            {!showAllReplies && hiddenCount > 0 && (
              <button onClick={() => setShowAllReplies(true)} style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 4 }}>
                Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        )}

        {/* Reply input */}
        <div style={{ borderTop: '0.5px solid var(--border)', marginTop: replies.length > 0 ? 4 : 8, paddingTop: 6 }}>
          <input
            placeholder="Reply..."
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onFocus={() => onReplyFocusChange?.(true)}
            onBlur={() => { setTimeout(() => onReplyFocusChange?.(false), 150) }}
            onKeyDown={async e => {
              if (e.key === 'Enter' && !e.shiftKey && replyText.trim() && !submittingReply) {
                e.preventDefault()
                setSubmittingReply(true)
                try { await onReplySubmit(comment.id, replyText.trim()); setReplyText('') }
                catch { /* ignore */ }
                finally { setSubmittingReply(false) }
              }
            }}
            style={{
              width: '100%', background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '5px 8px', fontSize: 12, color: 'var(--text)',
              outline: 'none', boxSizing: 'border-box',
            }}
            onMouseEnter={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--accent)' }}
            onMouseLeave={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)' }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Comment range marker ─────────────────────────────────────────────────────

function CommentRangeMarker({ comment, durationMs, dotTopOffset, commentMode, onDelete, currentUserId, isOwner, onReplyCreate }: {
  comment: TrackComment
  durationMs: number
  dotTopOffset: number
  commentMode: boolean
  onDelete: (id: string) => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
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

  return (
    <div
      ref={rangeRef}
      className="absolute top-0 h-full z-[3]"
      style={{
        left: `${startPct}%`,
        width: `${widthPct}%`,
        pointerEvents: commentMode ? 'none' : 'auto',
        minWidth: 2,
      }}
      onMouseEnter={() => { if (!commentMode) { cancelHide(); setShowTooltip(true) } }}
      onMouseLeave={scheduleHide}
    >
      {/* Range fill */}
      <div
        className="absolute inset-0 transition-colors duration-150"
        style={{ background: tooltipVisible ? 'rgba(99, 102, 241, 0.18)' : 'rgba(99, 102, 241, 0.08)' }}
      />
      {/* Left edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150"
        style={{ left: 0, width: 1.5, background: '#6366F1', opacity: tooltipVisible ? 1.0 : 0.5 }}
      />
      {/* Right edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150"
        style={{ right: 0, width: 1.5, background: '#6366F1', opacity: tooltipVisible ? 1.0 : 0.5 }}
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
    const handler = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
  const caretOffset = Math.max(8, Math.min(W - 12, lineX - left))

  return createPortal(
    <div
      ref={bubbleRef}
      className="fixed z-[5000] rounded-xl p-3"
      style={{
        left, top: waveformTop - 8, width: W, transform: 'translateY(-100%)',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--accent)',
      }}
    >
      <div className="absolute pointer-events-none" style={{
        bottom: -4, left: caretOffset - 4,
        borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
        borderTop: '4px solid var(--bg-card)',
      }} />
      {currentUser && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            background: `${avatarColor(currentUser.username)}33`,
            border: `1px solid ${avatarColor(currentUser.username)}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 7, fontWeight: 600, color: avatarColor(currentUser.username), flexShrink: 0,
          }}>
            {currentUser.username.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-sec)', fontWeight: 500 }}>{currentUser.username}</span>
        </div>
      )}
      <div className="text-[10px] text-accent tabular-nums mb-2">
        {fmtMs(startMs)} → {fmtMs(endMs)}
      </div>
      <input
        ref={inputRef} value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
        placeholder="Add comment..."
        className="w-full bg-transparent outline-none text-[13px] text-bright placeholder:text-dim"
      />
      <div className="flex justify-between items-center mt-2 pt-2" style={{ borderTop: '0.5px solid var(--border-light)' }}>
        <span className="text-[10px] text-dim">esc to cancel</span>
        <button
          onClick={submit}
          disabled={submitting || !text.trim()}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium text-bright transition-colors duration-150 ${errored ? 'bg-danger' : 'bg-accent hover:bg-accent-dim'} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {submitting ? '…' : errored ? 'Error' : 'Send'}
        </button>
      </div>
    </div>,
    document.body
  )
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({
  trackId, muted, playedRatio, color, durationMs,
  commentMode, comments, activeInput, audioReady,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput, onReady,
  currentUserId, isOwner, onReplyCreate, currentUser,
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
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>([])
  const [ready, setReady] = useState(false)
  const [animProgress, setAnimProgress] = useState(0) // 0 = flat dots, 1 = full bars
  const animRafRef = useRef(0)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setContainerWidth(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Fast path: bars already decoded for this track — render instantly.
      const cachedBars = waveformBarsCache.get(trackId)
      if (cachedBars) {
        barsRef.current = cachedBars
        setReady(true)
        onReady?.()
        return
      }
      try {
        const actx = new AudioContext()
        // Use cached ArrayBuffer if available (avoids network round-trip).
        const cachedAB = audioArrayBufferCache.get(trackId)
        let ab: ArrayBuffer
        if (cachedAB) {
          ab = cachedAB.slice(0) // slice() because decodeAudioData() detaches
        } else {
          const res = await fetch(`/api/tracks/${trackId}/stream`)
          ab = await res.arrayBuffer()
          audioArrayBufferCache.set(trackId, ab.slice(0)) // store before decode consumes it
        }
        const decoded = await actx.decodeAudioData(ab)
        const raw = decoded.getChannelData(0)
        const N = 72
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
          onReady?.()
        }
        actx.close()
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [trackId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth || 200
    const h = canvas.offsetHeight || 34
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const barW = 3
    const gap = 3
    const step = barW + gap
    const count = Math.floor((w + gap) / step)
    const pivot = Math.floor(count * playedRatio)
    const unplayedOpacity = isDark ? 0.25 : 0.35
    const bars = barsRef.current
    for (let i = 0; i < count; i++) {
      // Lerp from minimum dot height (2px) to full amplitude height
      const amp = bars.length ? (bars[Math.floor(i * bars.length / count)] ?? 0) : 0
      const targetBh = Math.max(2, amp * h * 0.88)
      const bh = 2 + (targetBh - 2) * animProgress
      ctx.globalAlpha = muted ? 0.12 : (i < pivot ? 1.0 : unplayedOpacity)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(i * step, (h - bh) / 2, barW, bh, barW / 2)
      ctx.fill()
    }
  }, [animProgress, muted, playedRatio, color, isDark, containerWidth, ready])

  // When audio becomes ready, animate bars from flat dots → full height (ease-out cubic, 320 ms).
  useEffect(() => {
    cancelAnimationFrame(animRafRef.current)
    if (!ready) { setAnimProgress(0); return }
    setAnimProgress(0)
    const start = performance.now()
    const DURATION = 320
    function tick(now: number) {
      const t = Math.min((now - start) / DURATION, 1)
      setAnimProgress(1 - (1 - t) ** 3)
      if (t < 1) animRafRef.current = requestAnimationFrame(tick)
    }
    animRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRafRef.current)
  }, [ready])

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

  // Attach window-level mouseup so releasing outside the waveform still finalizes
  useEffect(() => {
    const handler = () => finalizeDragFnRef.current()
    window.addEventListener('mouseup', handler)
    return () => window.removeEventListener('mouseup', handler)
  }, [])

  function handleMouseDown(e: React.MouseEvent) {
    if (!commentMode) return
    e.preventDefault() // prevent text selection
    const pct = getXPercent(e.clientX)
    dragRef.current = { active: true, startPct: pct, currentPct: pct }
    setDragRect({ startX: pct, endX: pct })
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!commentMode || !dragRef.current?.active) return
    const pct = Math.max(0, Math.min(1, getXPercent(e.clientX)))
    dragRef.current.currentPct = pct
    setDragRect({ startX: dragRef.current.startPct, endX: pct })
  }

  const overlapOffsets = computeOverlapOffsets(comments)
  const thisInputActive = activeInput?.trackId === trackId

  const cursor = commentMode
    ? (dragRect !== null ? 'ew-resize' : 'crosshair')
    : 'default'

  const dragSpan = dragRect ? Math.abs(dragRect.endX - dragRect.startX) : 0

  return (
    <div
      ref={containerRef}
      className="relative overflow-visible"
      style={{ cursor, userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
      onMouseDown={handleMouseDown}
      onMouseMove={commentMode ? handleMouseMove : undefined}
    >
      {/* z-index 1: waveform bars (dots while loading, grows to full on ready) */}
      <canvas ref={canvasRef} className="w-full block relative z-[1]" style={{ height: 34 }} />

      {/* z-index 3: saved comment ranges (only after audio is decoded) */}
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
        />
      ))}

      {/* z-index 4: active drag selection rectangle */}
      {commentMode && dragRect !== null && dragSpan > 0 && (
        <>
          <div
            className="absolute top-0 bottom-0 z-[4] pointer-events-none"
            style={{
              left: `${Math.min(dragRect.startX, dragRect.endX) * 100}%`,
              width: `${dragSpan * 100}%`,
              background: 'rgba(99, 102, 241, 0.15)',
            }}
          />
          {/* Left edge */}
          <div
            className="absolute top-0 bottom-0 z-[4] pointer-events-none"
            style={{
              left: `${Math.min(dragRect.startX, dragRect.endX) * 100}%`,
              width: 1.5,
              background: '#6366F1',
              opacity: 0.8,
            }}
          />
          {/* Right edge */}
          {dragSpan > 0.01 && (
            <div
              className="absolute top-0 bottom-0 z-[4] pointer-events-none"
              style={{
                left: `${Math.max(dragRect.startX, dragRect.endX) * 100}%`,
                width: 1.5,
                background: '#6366F1',
                opacity: 0.8,
              }}
            />
          )}
          {/* Time label above right edge */}
          {dragSpan > 0.01 && (
            <div
              className="absolute z-[4] pointer-events-none text-white text-[10px] px-1.5 py-0.5 rounded-[4px] whitespace-nowrap tabular-nums"
              style={{
                background: '#6366F1',
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
          className="absolute top-0 bottom-0 z-[4] pointer-events-none"
          style={{
            left: `${activeInput.startXPercent * 100}%`,
            width: `${(activeInput.endXPercent - activeInput.startXPercent) * 100}%`,
            background: 'rgba(99, 102, 241, 0.15)',
            borderLeft: '1px solid rgba(99, 102, 241, 0.8)',
            borderRight: '1px solid rgba(99, 102, 241, 0.8)',
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

function usePlayer(tracks: Track[], versionId: string, project: Project | null) {
  const actxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const bufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  const startRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  // MIDI playback refs — soundfont notes scheduled via AudioContext
  const midiScheduledRef = useRef<AudioNode[]>([])
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
  const playingRef = useRef(playing)
  playingRef.current = playing
  const [trackDurations, setTrackDurations] = useState<Map<string, number>>(new Map())

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
    const ctx = new AudioContext()
    actxRef.current = ctx
    const masterGain = ctx.createGain()
    masterGain.gain.value = volume
    masterGain.connect(ctx.destination)
    masterGainRef.current = masterGain
    bufsRef.current = new Map()
    setLoaded(0)
    let maxDur = 0

    // MIDI tracks intentionally excluded from maxDur — the project timeline
    // is governed by audio-only duration. MIDI notes scheduled via soundfont
    // already play at the correct offset; they don't stretch the timeline.

    Promise.all(audioTracks.map(async t => {
      try {
        // Use cached ArrayBuffer to avoid re-fetching audio on version revisit.
        const cachedAB = audioArrayBufferCache.get(t.id)
        let ab: ArrayBuffer
        if (cachedAB) {
          ab = cachedAB.slice(0) // fresh copy — decodeAudioData() detaches
        } else {
          const res = await fetch(`/api/tracks/${t.id}/stream`)
          ab = await res.arrayBuffer()
          audioArrayBufferCache.set(t.id, ab.slice(0))
        }
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
    return () => { cancelled = true; ctx.close(); cancelAnimationFrame(rafRef.current) }
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
      if (mutedTracksRef.current.has(midiTrack.id)) continue
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

  const play = useCallback(async (offset = offsetRef.current, tracksOverride?: Track[]) => {
    const ctx = actxRef.current
    if (!ctx) return
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
    const audioCtxPlayTime = ctx.currentTime
    bufsRef.current.forEach((buf, id) => {
      const trackMeta = trackMetaMap.get(id)
      const trackOffsetSec = (trackMeta?.start_bar ?? 0) * projBarDurSecP
      const trackEndSec = trackOffsetSec + buf.duration
      // Skip tracks that end before the playback position
      if (trackEndSec <= offset) return
      const g = ctx.createGain()
      g.gain.value = mutedTracksRef.current.has(id) ? 0 : 1
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
    const dur = duration || 1
    const tick = () => {
      const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
      if (elapsed >= dur) { setPlaying(false); setCurrentTime(0); offsetRef.current = 0; return }
      setCurrentTime(elapsed)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [duration, stopSources, scheduleMidiNotes])

  const pause = useCallback(() => {
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

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    if (masterGainRef.current) masterGainRef.current.gain.value = v
    if (typeof window !== 'undefined') localStorage.setItem('trackbase_volume', String(v))
  }, [])

  return { playing, currentTime, duration, loaded, total: audioTracks.length, mutedTracks, volume, setVolume, play: () => play(), pause, seek, toggleMute, audioContext: actxRef, trackDurations }
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionButton({
  onClick, href, tooltip, color, hoverBg, hoverBorderColor, hoverColor, children,
}: {
  onClick?: () => void
  href?: string
  tooltip: string
  color: string
  hoverBg?: string
  hoverBorderColor?: string
  hoverColor?: string
  children: React.ReactNode
}) {
  const [hovered, setHovered] = useState(false)

  const buttonStyle: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s, color 0.15s',
    border: `0.5px solid ${hovered && hoverBorderColor ? hoverBorderColor : 'var(--border)'}`,
    background: hovered && hoverBg ? hoverBg : 'transparent',
    color: hovered && hoverColor ? hoverColor : color,
    textDecoration: 'none',
  }

  const handlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  }

  return (
    <div className="relative shrink-0">
      {href ? (
        <a href={href} download style={buttonStyle} {...handlers}>{children}</a>
      ) : (
        <button onClick={onClick} style={buttonStyle} {...handlers}>{children}</button>
      )}
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '100%', left: '50%',
          transform: `translateX(-50%) translateY(${hovered ? 0 : 4}px)`,
          opacity: hovered ? 1 : 0, marginBottom: 4,
          transition: 'opacity 0.15s, transform 0.15s',
          background: 'var(--bg-card)', border: '0.5px solid var(--border-light)',
          borderRadius: 6, padding: '4px 8px',
          fontSize: 11, color: 'var(--text-sec)',
          whiteSpace: 'nowrap', zIndex: 20,
        }}
      >{tooltip}</div>
    </div>
  )
}

// ─── Icon picker popover ──────────────────────────────────────────────────────

const ICON_EMOJIS = ['🥁','🎸','🎹','🎤','🎵','🎷','🎺','🎻','🪗','🎙','🔊','✨']
const ICON_COLORS = TRACK_ICON_COLORS

function IconPicker({ trackId, initialEmoji, initialColor, onApply, onClose }: {
  trackId: string
  initialEmoji: string | null
  initialColor: string | null
  onApply: (emoji: string, color: string) => void
  onClose: () => void
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
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
        {ICON_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} style={{
            width: 22, height: 22, borderRadius: '50%', background: resolveTrackIconColor(c, isDark),
            border: `2px solid ${color === c ? 'white' : 'transparent'}`,
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
          borderRadius: 6, padding: '4px 12px', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>{saving ? '…' : 'Apply'}</button>
      </div>
    </div>
  )
}

// ─── TrackRow ─────────────────────────────────────────────────────────────────

function TrackRow({
  track, index, muted, changed, currentTimeMs,
  commentMode, activeInput, audioReady,
  onToggleMute, onReplace,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput,
  onDeleteTrack, onRenameTrack, onIconUpdate, onMidiDataUpdate, onStartBarUpdate,
  onDragStartOffset, onDragEndOffset, otherTrackDragging,
  currentUserId, isOwner, onReplyCreate, currentUser,
  projectId, versionId, project, totalBars, runtimeDurationMs,
}: {
  track: Track; index: number; muted: boolean; changed: boolean
  currentTimeMs: number; commentMode: boolean
  activeInput: ActiveCommentInput | null; audioReady: boolean
  onToggleMute: () => void; onReplace: (f: File) => void
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
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const fileRef = useRef<HTMLInputElement>(null)
  const col = palette(index)
  const instrument = detectInstrument(track.name)
  const isMidi = track.file_type === 'midi'

  const iconBg = resolveTrackIconColor(track.icon_color, isDark)

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
  const origStartBarRef = useRef(0)
  const dragPreviewBarRef = useRef<number | null>(null)
  const waveformColRef = useRef<HTMLDivElement>(null)

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
  const isAudioLoading = !isMidi && !waveformReady
  const layoutWidthPercent = isAudioLoading
    ? Math.max(widthPercent, 100 - startPercent)
    : widthPercent

  // Drag-to-offset mouse handlers
  function handleOffsetMouseDown(e: React.MouseEvent) {
    if (commentMode) return
    e.preventDefault()
    dragStartXRef.current = e.clientX
    origStartBarRef.current = track.start_bar ?? 0
    const initialBar = track.start_bar ?? 0
    setIsOffsetDragging(true)
    dragPreviewBarRef.current = initialBar
    setDragPreviewBar(initialBar)
    onDragStartOffset()
  }

  useEffect(() => {
    if (!isOffsetDragging) return
    function onMouseMove(e: MouseEvent) {
      const colEl = waveformColRef.current
      if (!colEl) return
      const containerWidth = colEl.offsetWidth
      const barsPerPixel = totalBars / containerWidth
      const deltaX = e.clientX - dragStartXRef.current
      const newStartBar = Math.max(0, Math.round(origStartBarRef.current + deltaX * barsPerPixel))
      dragPreviewBarRef.current = newStartBar
      setDragPreviewBar(newStartBar)
    }
    async function onMouseUp() {
      setIsOffsetDragging(false)
      onDragEndOffset()
      const newBar = dragPreviewBarRef.current
      dragPreviewBarRef.current = null
      if (newBar !== null && newBar !== (track.start_bar ?? 0)) {
        try {
          await onStartBarUpdate(track.id, newBar)
        } catch { /* ignore */ }
      }
      setDragPreviewBar(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
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

  return (
    <>
    <div
      data-track-row
      className="relative grid items-center h-[62px] gap-3 px-[22px] overflow-visible"
      style={{
        gridTemplateColumns: '20px 32px 118px 1fr 22px auto',
        background: rowBg,
        boxShadow: isOffsetDragging
          ? '0 2px 8px rgba(0,0,0,0.15)'
          : confirmDelete || deleteError
          ? 'inset 0 0 0 0.5px rgba(239,68,68,0.2)'
          : 'none',
        borderBottom: pianoRollOpen ? 'none' : '0.5px solid var(--border)',
        transition: 'background 0.15s, box-shadow 0.15s, opacity 0.15s',
        opacity: rowOpacity,
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
    >
      <span className="text-center text-[11px] text-dim tabular-nums">{index + 1}</span>

      {/* Icon square — click to open picker */}
      <div className="relative">
        <button
          onClick={() => setShowIconPicker(p => !p)}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity duration-150 hover:opacity-80"
          style={{ background: iconBg, border: 'none', cursor: 'pointer', padding: 0 }}
          title="Change icon"
        >
          {track.icon_emoji ? (
            <span style={{ fontSize: 15, lineHeight: 1 }}>{track.icon_emoji}</span>
          ) : waveformReady ? (
            <InstrumentSVG type={instrument} color={col.fg} />
          ) : (
            <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke={col.fg} strokeWidth="1.5" strokeOpacity="0.2" />
              <path d="M6.5 1.5A5 5 0 0 1 11.5 6.5" stroke={col.fg} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
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

      {/* Track name — double-click or pencil to rename */}
      <div className="min-w-0">
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
            style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
              borderRadius: 5, padding: '2px 6px', fontSize: 13, color: 'var(--text)',
              width: 120, outline: 'none',
            }}
          />
        ) : (
          <div
            className="flex items-center gap-1 group"
            onDoubleClick={startEdit}
          >
            <div
              className="text-[13px] text-soft truncate"
              style={{ color: nameFlash ? 'var(--accent)' : undefined, transition: 'color 0.3s' }}
            >
              {displayName}
            </div>
            {/* MIDI badge */}
            {isMidi && (
              <span style={{
                background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                color: 'var(--accent)', fontSize: 9, textTransform: 'uppercase',
                letterSpacing: '0.5px', padding: '1px 5px', borderRadius: 3,
                flexShrink: 0, lineHeight: 1.5,
              }}>MIDI</span>
            )}
            {rowHovered && (
              <button
                onClick={startEdit}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', padding: 0, lineHeight: 1,
                  display: 'flex', alignItems: 'center',
                }}
                title="Rename"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M7.5 1.5l2 2-6 6H1.5v-2l6-6z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="mt-0.5">
          {changed ? (
            <span className="text-[10px] text-amber flex items-center gap-1">
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><circle cx="2" cy="2" r="1" fill="currentColor" /><circle cx="7" cy="2" r="1" fill="currentColor" /><circle cx="2" cy="7" r="1" fill="currentColor" /><path d="M3 2h3M2 3v3M7 3l-5 5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" /></svg>
              modified
            </span>
          ) : isMidi && track.midi_data ? (
            <span className="text-[11px] text-dim truncate block">
              {track.midi_data.notes.length} notes
              {' · '}
              {trackDurationBars} bars
              {(track.start_bar ?? 0) > 0 ? ` · starts at bar ${(track.start_bar ?? 0) + 1}` : ''}
              {' · '}
              {gmProgramLabel(track.midi_data.instrument)}
            </span>
          ) : (
            <span className="text-[11px] text-dim truncate block">
              {track.original_filename ?? '—'}
              {track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
              {(track.start_bar ?? 0) > 0 ? ` · starts at bar ${(track.start_bar ?? 0) + 1}` : ''}
            </span>
          )}
        </div>
      </div>

      <div ref={waveformColRef} className="relative min-w-0 overflow-hidden" style={{ height: 34 }} data-waveform-col>
        {/* Subtle diagonal stripe pattern for empty space */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, var(--border) 4px, var(--border) 5px)',
          opacity: 0.3,
        }} />

        {/* Waveform/MIDI content — absolutely positioned at start_bar */}
        <div
          style={{
            position: 'absolute',
            left: `${startPercent}%`,
            width: `${layoutWidthPercent}%`,
            height: '100%',
            cursor: isOffsetDragging ? 'grabbing' : 'grab',
            borderLeft: effectiveStartBar > 0 ? '1px solid var(--border-light)' : 'none',
            zIndex: 1,
            transition: isOffsetDragging ? 'none' : 'width 0.25s ease-out',
          }}
          onMouseDown={handleOffsetMouseDown}
        >
          {isMidi ? (
            track.midi_data ? (
              <div style={{ width: '100%', height: '100%', opacity: muted ? 0.35 : 1 }}>
                <MiniPianoRoll
                  midiData={track.midi_data}
                  color={col.fg}
                  projectBpm={project.bpm ?? undefined}
                  totalProjectMs={trackOwnDurationMs}
                  height={34}
                  midiStartBar={0}
                />
              </div>
            ) : (
              <div style={{ width: '100%', height: 34, background: 'var(--bg-card)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Loading…</span>
              </div>
            )
          ) : (
            <Waveform
              trackId={track.id} muted={muted} playedRatio={trackPlayedRatio} color={col.fg}
              durationMs={trackOwnDurationMs} commentMode={commentMode}
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
            />
          )}
        </div>

        {/* Snap indicator during drag */}
        {isOffsetDragging && dragPreviewBar !== null && (() => {
          const snapPct = totalBars > 0 ? (dragPreviewBar / totalBars) * 100 : 0
          return (
            <>
              <div style={{
                position: 'absolute', left: `${snapPct}%`, top: 0, height: '100%',
                width: 1, background: 'var(--accent)', zIndex: 10, pointerEvents: 'none',
              }} />
              <div style={{
                position: 'absolute', left: `${snapPct}%`, top: 2, zIndex: 10,
                transform: 'translateX(-50%)', pointerEvents: 'none',
                background: 'var(--accent)', color: 'white',
                fontSize: 10, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
              }}>Bar {dragPreviewBar + 1}</div>
            </>
          )
        })()}
      </div>

      <button
        onClick={onToggleMute}
        className={`w-[22px] h-[22px] rounded-md text-[10px] font-medium transition-all duration-150 ${muted ? 'text-accent' : 'text-dim hover:text-muted'}`}
        style={{ border: muted ? '0.5px solid var(--accent)' : '0.5px solid var(--border-light)', background: muted ? 'rgba(99,102,241,0.1)' : 'transparent' }}
      >M</button>

      {/* Action buttons / inline delete confirm */}
      <div className="flex items-center gap-1 shrink-0">
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] whitespace-nowrap" style={{ color: '#ef4444' }}>Delete track?</span>
            <button
              onClick={() => setConfirmDelete(false)}
              className="h-[26px] px-2.5 rounded-md text-[11px] font-medium"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Cancel</button>
            <button
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="h-[26px] px-2.5 rounded-md text-[11px] font-medium text-white disabled:opacity-60"
              style={{ background: '#ef4444', border: '0.5px solid #ef4444', cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => { if (!deleting) e.currentTarget.style.background = '#dc2626' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#ef4444' }}
            >{deleting ? '…' : 'Delete'}</button>
          </div>
        ) : (
          <>
            {/* Edit MIDI button — always visible for MIDI tracks */}
            {isMidi && (
              <ActionButton
                tooltip="Edit MIDI"
                color="var(--accent)"
                hoverBg="rgba(99,102,241,0.10)"
                hoverBorderColor="rgba(99,102,241,0.30)"
                hoverColor="var(--accent)"
                onClick={() => setPianoRollOpen(p => !p)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="8" width="20" height="12" rx="2" />
                  <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                  <line x1="6" y1="12" x2="6" y2="17" />
                  <line x1="10" y1="12" x2="10" y2="17" />
                  <line x1="14" y1="12" x2="14" y2="17" />
                  <line x1="18" y1="12" x2="18" y2="17" />
                  <line x1="8" y1="12" x2="8" y2="15" />
                  <line x1="12" y1="12" x2="12" y2="15" />
                  <line x1="16" y1="12" x2="16" y2="15" />
                </svg>
              </ActionButton>
            )}
            <ActionButton
              tooltip="Replace track"
              color="#6366F1"
              hoverBg="rgba(99,102,241,0.10)"
              hoverBorderColor="rgba(99,102,241,0.30)"
              onClick={() => fileRef.current?.click()}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h11a3 3 0 0 1 3 3v1" /><path d="M14 4l3 3-3 3" />
                <path d="M21 17H10a3 3 0 0 1-3-3v-1" /><path d="M10 20l-3-3 3-3" />
              </svg>
            </ActionButton>
            {!isMidi && (
              <ActionButton
                tooltip="Download as WAV"
                color="var(--text-muted)"
                hoverBg="var(--bg-surface)"
                hoverColor="var(--text-sec)"
                href={`/api/tracks/${track.id}/download`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  <path d="M7 11l5 5 5-5" /><line x1="12" y1="4" x2="12" y2="16" />
                </svg>
              </ActionButton>
            )}
            <ActionButton
              tooltip="Delete track"
              color="var(--text-dim)"
              hoverBg="rgba(239,68,68,0.08)"
              hoverBorderColor="#ef4444"
              hoverColor="#ef4444"
              onClick={() => setConfirmDelete(true)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
                <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
              </svg>
            </ActionButton>
          </>
        )}
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

// ─── Skeleton track row (DnD uploads) ────────────────────────────────────────

function SkeletonTrackRow({ name, progress, error, errorMsg, onRetry }: {
  name: string; progress: number; error: boolean; errorMsg: string; onRetry: () => void
}) {
  return (
    <div
      className="flex items-center h-[72px] px-[22px] gap-3"
      style={{
        borderBottom: '0.5px solid var(--border)',
        borderLeft: error ? '3px solid #ef4444' : undefined,
      }}
    >
      {/* Icon placeholder */}
      <div className="w-8 h-8 rounded-lg shrink-0 animate-pulse" style={{ background: 'var(--bg-card)' }} />
      {/* Name + progress */}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate mb-1" style={{ color: 'var(--text-sec)' }}>{name}</div>
        {error ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: '#ef4444' }}>Upload failed{errorMsg ? ` — ${errorMsg}` : ''}</span>
            <button
              onClick={onRetry}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 5.5a4 4 0 1 0 .5-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M1.5 2v3.5H5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Retry
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
            </div>
            <span className="text-[11px] shrink-0" style={{ color: 'var(--text-dim)' }}>
              {progress > 0 ? `${progress}%` : 'Uploading…'}
            </span>
          </div>
        )}
      </div>
      {/* Waveform shimmer */}
      {!error && (
        <div className="rounded-md shrink-0 overflow-hidden" style={{ width: 160, height: 40, background: 'var(--bg-card)', position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent) 20%, transparent) 50%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite linear',
          }} />
        </div>
      )}
    </div>
  )
}

// ─── Player bar ───────────────────────────────────────────────────────────────

function PlayerBar({ playing, currentTime, duration, loaded, total, volume, onPlay, onPause, onSeek, onVolume }: {
  playing: boolean; currentTime: number; duration: number; loaded: number; total: number; volume: number
  onPlay: () => void; onPause: () => void; onSeek: (t: number) => void; onVolume: (v: number) => void
}) {
  const pct = duration > 0 ? currentTime / duration : 0
  const [dragging, setDragging] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [prevVolume, setPrevVolume] = useState(1)
  const barRef = useRef<HTMLDivElement>(null)
  const volRef = useRef<HTMLDivElement>(null)

  function posToTime(clientX: number) {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }

  function toggleMute() {
    if (volume > 0) { setPrevVolume(volume); onVolume(0) }
    else onVolume(prevVolume || 1)
  }

  // Close volume popover on outside click
  useEffect(() => {
    if (!showVolume) return
    function handler(e: MouseEvent) {
      if (volRef.current && !volRef.current.contains(e.target as Node)) setShowVolume(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showVolume])

  const isLoading = loaded < total && total > 0
  const volPct = Math.round(volume * 100)

  // 4-state volume icon: 0=muted, 1-33=low, 34-66=mid, 67-100=full
  function VolumeIcon() {
    if (volume === 0) return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M9.5 4.5l3 3M12.5 4.5l-3 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
    )
    if (volPct <= 33) return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M10 6a0.7 0.7 0 0 1 0 2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
    )
    if (volPct <= 66) return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M10 5a2 2 0 0 1 0 4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
    )
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M10 4a3.5 3.5 0 0 1 0 6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <div className="flex items-center h-[52px] shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
      {/* Play button — flush to left edge */}
      <button onClick={playing ? onPause : onPlay} disabled={total === 0} className="btn-play" style={{ flexShrink: 0, marginLeft: 0 }}>
        {isLoading ? (
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.25" />
            <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><rect x="2" y="2" width="3.5" height="10" rx="1" /><rect x="8.5" y="2" width="3.5" height="10" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><path d="M3.5 2l8 5-8 5V2z" /></svg>
        )}
      </button>

      {/* Combined time — "0:42 / 2:55" */}
      <span className="text-[12px] tabular-nums shrink-0 whitespace-nowrap" style={{ marginLeft: 10 }}>
        <span style={{ color: 'var(--text-sec)' }}>{fmtTime(currentTime)}</span>
        <span style={{ color: 'var(--text-muted)' }}> / {fmtTime(duration)}</span>
      </span>

      {/* Progress bar — flex: 1 */}
      <div
        ref={barRef}
        className="flex-1 h-5 flex items-center cursor-pointer"
        style={{ margin: '0 12px' }}
        onMouseDown={e => { setDragging(true); onSeek(posToTime(e.clientX)) }}
        onMouseMove={e => { if (dragging) onSeek(posToTime(e.clientX)) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        <div className="w-full rounded-full relative" style={{ height: 4, background: 'var(--progress-track)' }}>
          <div className="h-full rounded-full relative" style={{ width: `${pct * 100}%`, background: 'var(--accent)' }}>
            <div className="absolute top-1/2 rounded-full bg-white" style={{ right: -5, width: 10, height: 10, transform: 'translateY(-50%)', boxShadow: '0 0 0 2px rgba(99,102,241,0.3)' }} />
          </div>
        </div>
      </div>

      {/* Volume button + popover — flush right */}
      <div ref={volRef} style={{ position: 'relative', marginRight: 0 }}>
        <button
          onClick={() => setShowVolume(v => !v)}
          className="text-dim hover:text-muted transition-colors duration-150 p-1"
          title="Volume"
        >
          <VolumeIcon />
        </button>
        {showVolume && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '12px 10px',
            width: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            {/* Percentage label */}
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{volPct}</span>
            {/* Vertical slider */}
            <input
              type="range"
              min={0} max={100} step={1}
              value={volPct}
              onChange={e => onVolume(parseInt(e.target.value) / 100)}
              style={{
                writingMode: 'vertical-lr' as const,
                direction: 'rtl' as const,
                height: 80,
                width: 20,
                cursor: 'pointer',
                accentColor: 'var(--accent)',
              }}
            />
            {/* Mute toggle */}
            <button
              onClick={toggleMute}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: volume === 0 ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center',
              }}
              title={volume === 0 ? 'Unmute' : 'Mute'}
            >
              {volume === 0 ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                  <path d="M9.5 4.5l3 3M12.5 4.5l-3 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                  <path d="M10 4a3.5 3.5 0 0 1 0 6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
                </svg>
              )}
            </button>
          </div>
        )}
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ versions, activeId, onSelect, onNewBranch, onMerge, mergeCheckingId, storageUsed, storageLimit, commentCounts }: {
  versions: Version[]; activeId: string
  onSelect: (id: string) => void; onNewBranch: () => void; onMerge: (id: string) => void
  mergeCheckingId: string | null
  storageUsed: number
  storageLimit: number
  commentCounts: Record<string, number>
}) {
  function dotColor(v: Version) {
    return v.merged_at ? 'var(--green)' : v.type === 'main' ? 'var(--accent)' : 'var(--amber)'
  }
  function badge(v: Version) {
    if (v.merged_at) return { label: 'MERGED', bg: 'var(--badge-merged-bg)', color: 'var(--green)' }
    if (v.type === 'branch') return { label: 'BRANCH', bg: 'var(--badge-branch-bg)', color: 'var(--amber)' }
    return { label: 'CURRENT', bg: 'var(--badge-current-bg)', color: 'var(--accent)' }
  }

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

  return (
    <aside className="w-[208px] shrink-0 flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)', borderRight: '0.5px solid var(--border)' }}>
      <div className="flex-1 overflow-y-auto px-3 pt-4 pb-2">

        <p className="text-[10px] font-medium uppercase px-[10px] mb-[10px]" style={{ color: 'var(--text-muted)', letterSpacing: '1px' }}>Versions</p>

        {[main, ...branches].filter(Boolean).map(v => {
          const b = badge(v!)
          const isActive = v!.id === activeId
          return (
            <button
              key={v!.id}
              onClick={() => onSelect(v!.id)}
              className="w-full text-left rounded-lg mb-1 transition-colors duration-150"
              style={{ padding: '8px 10px', background: isActive ? 'var(--bg-card)' : 'transparent' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-card)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-px" style={{ background: dotColor(v!) }} />
                <span className="flex-1 text-[13px] truncate" style={{ color: 'var(--text-sec)' }}>{v!.name}</span>
                {(commentCounts[v!.id] ?? 0) > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--text-dim)' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 2.5h7a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5H6L4.5 9 3 7.5H1.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="0.7" />
                    </svg>
                    <span style={{ fontSize: 9 }}>{commentCounts[v!.id]}</span>
                  </span>
                )}
                <span className="text-[9px] font-semibold rounded shrink-0 px-[7px] py-[2px] tracking-wide" style={{ background: b.bg, color: b.color }}>
                  {b.label}
                </span>
              </div>
              <p className="text-[10px] mt-[2px] pl-[14px]" style={{ color: 'var(--text-dim)' }}>{fmtDate(v!.created_at)}</p>
            </button>
          )
        })}

        <p className="text-[10px] font-medium uppercase px-[10px] mt-5 mb-[10px]" style={{ color: 'var(--text-muted)', letterSpacing: '1px' }}>Actions</p>

        {/* Merge to main — shown only when a branch is active */}
        {canMerge && (
          <button
            onClick={() => !isChecking && onMerge(activeId)}
            disabled={isChecking}
            className="w-full flex items-center gap-2 rounded-lg mb-0.5 transition-colors duration-150 text-[13px]"
            style={{ padding: '8px 10px', color: isChecking ? 'var(--accent)' : 'var(--text-muted)', cursor: isChecking ? 'default' : 'pointer' }}
            onMouseEnter={e => { if (!isChecking) { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-sec)' } }}
            onMouseLeave={e => { if (!isChecking) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' } }}
          >
            {isChecking ? (
              <>
                <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
                  <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Checking…
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="9" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" /><path d="M3 4.5V7.5M9 4V6a3 3 0 0 1-3 3H4.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>
                Merge to main
              </>
            )}
          </button>
        )}

        {staticActions.map(({ label, icon, action }) => (
          <button
            key={label}
            onClick={action}
            className="w-full flex items-center gap-2 rounded-lg mb-0.5 transition-colors duration-150 text-[13px]"
            style={{ padding: '8px 10px', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-sec)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div style={{ height: '0.5px', background: 'var(--border)', margin: '0 10px' }} />
      <div className="px-4 py-3">
        <div className="flex justify-between mb-1.5">
          <span className="text-[10px] text-dim">Storage</span>
          <span className="text-[10px] text-dim">{formatBytes(storageUsed)} of {formatBytes(storageLimit)}</span>
        </div>
        <div className="h-0.5 rounded-full" style={{ background: 'var(--border)' }}>
          <div className="h-full rounded-full" style={{
            width: `${Math.min((storageUsed / storageLimit) * 100, 100)}%`,
            background: storageUsed / storageLimit > 0.95 ? '#ef4444'
              : storageUsed / storageLimit > 0.80 ? '#F59E0B'
              : 'var(--accent)',
          }} />
        </div>
        {storageUsed / storageLimit > 0.95 && (
          <p className="text-[10px] mt-1 m-0" style={{ color: '#ef4444' }}>Almost full — upgrade to continue uploading</p>
        )}
      </div>
    </aside>
  )
}

// ─── New branch modal ─────────────────────────────────────────────────────────

function NewBranchModal({ onConfirm, onCancel }: { onConfirm: (n: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="rounded-2xl p-5 w-[340px]" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-light)' }}>
        <p className="text-[14px] font-medium text-bright mb-4">New branch</p>
        <input
          autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); if (e.key === 'Escape') onCancel() }}
          placeholder="feature/new-guitar"
          className="w-full rounded-lg px-3 py-2 text-bright text-[13px] outline-none mb-4 transition-colors duration-150"
          style={{ background: 'var(--bg)', border: '0.5px solid var(--border-light)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-light)' }}
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-lg text-muted text-[12px] transition-colors duration-150"
            style={{ border: '0.5px solid var(--border-light)' }}
          >Cancel</button>
          <button onClick={() => name.trim() && onConfirm(name.trim())} className="btn-accent px-4 py-1.5 text-[12px]">Create</button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { bandId, projectId } = useParams<{ bandId: string; projectId: string }>()
  const cache = useVersionCache()
  const { user, profile } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [uploading, setUploading] = useState(false)
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
  const [waveformBounds, setWaveformBounds] = useState<{ left: number; right: number } | null>(null)
  const trackListRef = useRef<HTMLDivElement>(null)
  const tracksBodyRef = useRef<HTMLDivElement>(null)
  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingAddRow, setIsDraggingAddRow] = useState(false)
  const [skeletonTracks, setSkeletonTracks] = useState<Array<{ id: string; name: string; progress: number; error: boolean; errorMsg: string }>>([])
  const [dndProgress, setDndProgress] = useState<{ done: number; total: number } | null>(null)
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

  // Measure waveform column bounds for structure overlay alignment.
  // Uses [data-waveform-col] from an actual track row so the right offset
  // includes the button column (auto). Falls back to header child[3] when
  // no tracks are rendered yet.
  useEffect(() => {
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
  }, [activeTracks.length])


  const mainVersion = versions.find(v => v.type === 'main')
  const mainHashes = new Set((mainVersion?.tracks ?? []).map(t => t.file_hash))
  const isChanged = (t: Track) => !!mainVersion && activeVersionId !== mainVersion.id && !mainHashes.has(t.file_hash)

  const player = usePlayer(activeTracks, activeVersionId, project)
  const playerRef = useRef(player)
  playerRef.current = player

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
      const p = playerRef.current
      if (p.total === 0) return
      if (p.playing) p.pause()
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

  async function doUploadTrack(file: File, position: number) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name.replace(/\.[^/.]+$/, ''))
    fd.append('position', String(position))
    const res = await fetch(`/api/versions/${activeVersionId}/tracks/upload`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText)
  }

  async function handleAddTrack(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !activeVersionId) return
    e.target.value = ''
    setUploading(true)
    const errors: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        try {
          await doUploadTrack(files[i], activeTracks.length + i)
        } catch (err) {
          errors.push(`${files[i].name}: ${err instanceof Error ? err.message : 'Upload failed'}`)
        }
      }
      cache.invalidate(activeVersionId)
      await loadProject()
      if (errors.length) alert(errors.join('\n'))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Sequential upload with per-file skeleton rows (used by DnD)
  async function handleUploadFiles(files: File[]) {
    if (!files.length || !activeVersionId) return
    setDndProgress({ done: 0, total: files.length })
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const skeletonId = crypto.randomUUID()
      const baseName = file.name.replace(/\.[^.]+$/, '')
      setSkeletonTracks(prev => [...prev, { id: skeletonId, name: baseName, progress: 0, error: false, errorMsg: '' }])
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.addEventListener('progress', ev => {
            if (ev.lengthComputable) {
              const p = Math.round((ev.loaded / ev.total) * 100)
              setSkeletonTracks(prev => prev.map(s => s.id === skeletonId ? { ...s, progress: p } : s))
            }
          })
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else {
              try { reject(new Error(JSON.parse(xhr.responseText).error ?? 'Upload failed')) }
              catch { reject(new Error('Upload failed')) }
            }
          })
          xhr.addEventListener('error', () => reject(new Error('Network error')))
          const fd = new FormData()
          fd.append('file', file)
          fd.append('name', baseName)
          fd.append('position', String(activeTracks.length + i))
          xhr.open('POST', `/api/versions/${activeVersionId}/tracks/upload`)
          xhr.send(fd)
        })
        setSkeletonTracks(prev => prev.filter(s => s.id !== skeletonId))
        setDndProgress(d => d ? { done: d.done + 1, total: d.total } : null)
        cache.invalidate(activeVersionId)
        await loadProject()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setSkeletonTracks(prev => prev.map(s => s.id === skeletonId ? { ...s, error: true, errorMsg: msg } : s))
        setDndProgress(d => d ? { done: d.done + 1, total: d.total } : null)
      }
    }
    setDndProgress(null)
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

  if (loading) return <BrandSpinner />
  if (error || !project) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-danger">{error || 'Project not found'}</div>
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Topbar */}
      <header className="flex items-center h-[56px] shrink-0 px-[18px] gap-2.5" style={{ background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border)' }}>
        <a href="/dashboard" className="flex items-center no-underline mr-1.5">
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-sec)' }}>track</span>
          <span className="text-[14px] font-semibold text-accent tracking-tight">base</span>
        </a>
        <span className="text-lg leading-none" style={{ color: 'var(--border-light)' }}>·</span>
        <a href={`/band/${bandId}`} className="text-[13px] no-underline hover:underline" style={{ color: 'var(--text-muted)' }}>{project.band_name ?? 'Band'}</a>
        <span className="text-sm" style={{ color: 'var(--border-light)' }}>/</span>
        <span
          className="text-[13px] truncate max-w-[200px]"
          style={{ color: projectNameFlash ? 'var(--accent)' : 'var(--text-sec)', transition: 'color 0.3s' }}
        >
          {projectNameEditing ? projectNameValue || project.name : project.name}
        </span>
        <div className="flex-1" />
        <button onClick={handleShare} className="btn-topbar" style={{ color: shareCopied ? '#10B981' : undefined }}>
          {shareCopied ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2.5 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M5.5 9a2.5 2.5 0 0 1 0-5h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M7.5 4a2.5 2.5 0 0 1 0 5h-1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
          )}
          {shareCopied ? 'Copied!' : 'Share'}
        </button>
        <a href={`/api/versions/${activeVersionId}/export`} className="btn-topbar">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M3.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
          Export WAV
        </a>
        <button onClick={() => setShowBranchModal(true)} className="btn-accent">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 11V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7" stroke="white" strokeWidth="1" strokeLinecap="round"/><path d="M4 6h5M4 8.5h3" stroke="white" strokeWidth="1" strokeLinecap="round"/></svg>
          Save version
        </button>
        <ThemeToggle />
        <AvatarDropdown />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          versions={versions} activeId={activeVersionId}
          onSelect={id => { setActiveVersionId(id); setCommentMode(false); setActiveCommentInput(null) }}
          onNewBranch={() => setShowBranchModal(true)}
          onMerge={handleMergeClick}
          mergeCheckingId={mergeCheckingId}
          storageUsed={storageUsed}
          storageLimit={storageLimit}
          commentCounts={commentCounts}
        />

        <main
          className="flex flex-col flex-1 overflow-hidden min-w-0"
          style={{ background: 'var(--bg)', position: 'relative' }}
          onDragOver={handleContentDragOver}
          onDragLeave={handleContentDragLeave}
          onDrop={handleContentDrop}
        >
          {/* Full-screen drag overlay */}
          {isDragging && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 200, pointerEvents: 'none',
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              border: '2px dashed var(--accent)',
              borderRadius: 8,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 10,
            }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 4v16M8 14l8-8 8 8" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 26h24" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--accent)' }}>Drop files to add tracks</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>WAV, MP3, and MIDI supported</span>
            </div>
          )}

          {/* Content — dimmed while dragging */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', opacity: isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}>

          {/* Project header */}
          <div className="px-[22px] pt-4 pb-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  className="text-[17px] font-medium text-bright"
                  style={{
                    background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
                    borderRadius: 6, padding: '2px 10px',
                    width: 280, maxWidth: '100%', outline: 'none',
                  }}
                />
              ) : (
                <div className="flex items-center gap-1.5 group min-w-0" onDoubleClick={startProjectRename}>
                  <h1
                    className="text-[17px] font-medium text-bright truncate"
                    style={{
                      color: projectNameFlash ? 'var(--accent)' : undefined,
                      transition: 'color 0.3s',
                    }}
                  >
                    {project.name}
                  </h1>
                  <button
                    type="button"
                    onClick={startProjectRename}
                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-dim)', padding: 0, lineHeight: 1,
                      display: 'flex', alignItems: 'center',
                    }}
                    title="Rename project"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              )}
              <button
                onClick={() => setEditStructure(p => !p)}
                disabled={activeTracks.length === 0}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                  background: sections.length > 0 ? 'rgba(99,102,241,0.08)' : 'transparent',
                  border: sections.length > 0
                    ? '0.5px solid rgba(99,102,241,0.3)'
                    : '0.5px solid var(--border-light)',
                  color: sections.length > 0 ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: activeTracks.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: activeTracks.length === 0 ? 0.4 : 1,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (activeTracks.length > 0) {
                    e.currentTarget.style.borderColor = 'var(--accent)'
                    e.currentTarget.style.color = 'var(--accent)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = sections.length > 0 ? 'rgba(99,102,241,0.3)' : 'var(--border-light)'
                  e.currentTarget.style.color = sections.length > 0 ? 'var(--accent)' : 'var(--text-muted)'
                }}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <rect x="1" y="1" width="9" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="0.8"/>
                  <rect x="1" y="4.5" width="5" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="0.8"/>
                  <rect x="1" y="8" width="7" height="2.5" rx="0.6" stroke="currentColor" strokeWidth="0.8"/>
                </svg>
                {editStructure ? 'Done editing' : sections.length > 0 ? 'Edit structure' : '+ Add structure'}
              </button>
            </div>
            <p className="text-[11px] text-dim mt-0.5">
              {activeTracks.length} track{activeTracks.length !== 1 ? 's' : ''}
              {player.duration > 0 ? ` · ${fmtTime(player.duration)}` : ''}{' · updated today'}
            </p>
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[11px] text-dim mr-1">View:</span>
              {versions.map(v => {
                const isActive = v.id === activeVersionId
                const dotColor = v.merged_at ? 'var(--green)' : v.type === 'main' ? 'var(--accent)' : 'var(--amber)'
                return (
                  <button
                    key={v.id}
                    onClick={() => { setActiveVersionId(v.id); setCommentMode(false); setActiveCommentInput(null) }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] transition-all duration-150"
                    style={{ border: isActive ? '0.5px solid var(--border-light)' : '0.5px solid transparent', background: isActive ? 'var(--bg-card)' : 'transparent', color: isActive ? 'var(--text-sec)' : 'var(--text-muted)' }}
                    onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = 'var(--text-sec)'; e.currentTarget.style.background = 'var(--bg-surface)' } }}
                    onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' } }}
                  >
                    <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: dotColor }} />
                    {v.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Structure + transport — bar ruler, sections, play/time/volume */}
          {project && (
            <StructureOverlay
              project={project}
              versionId={activeVersionId}
              totalDurationMs={totalProjectDurationMs}
              sections={sections}
              onSectionsChange={setSections}
              editMode={editStructure}
              onEditModeChange={setEditStructure}
              waveformBounds={waveformBounds}
              currentTimeMs={player.currentTime * 1000}
              playing={player.playing}
              currentTime={player.currentTime}
              duration={player.duration}
              loaded={player.loaded}
              totalTracks={player.total}
              volume={player.volume}
              onPlay={player.play}
              onPause={player.pause}
              onSeek={player.seek}
              onVolume={player.setVolume}
            />
          )}

          {/* Comment mode banner */}
          <div className={`overflow-hidden transition-[height,opacity] duration-200 ${commentMode ? 'h-[34px] opacity-100' : 'h-0 opacity-0'}`}>
            <div className="flex items-center gap-2 px-[22px] h-[34px]" style={{ background: 'rgba(217,119,6,0.06)', borderBottom: '0.5px solid var(--border)' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="var(--amber)" strokeWidth="1"/><path d="M5 3v2.5M5 7v.5" stroke="var(--amber)" strokeWidth="1" strokeLinecap="round"/></svg>
              <span className="text-[11px] text-amber">Comment mode — drag on any waveform to select a time range</span>
            </div>
          </div>

          {/* Track list */}
          <div ref={trackListRef} className="flex-1 overflow-y-auto overflow-x-hidden" style={{ position: 'relative' }}>
            {/* tracksBodyRef: position:relative so the section overlay can anchor inside it */}
            <div ref={tracksBodyRef} style={{ position: 'relative' }}>

              {/* Section boundary dashed lines overlay */}
              {sections.length > 0 && project && totalProjectDurationMs > 0 && (() => {
                const { barDurationMs } = getBarMath(project, totalProjectDurationMs)
                const wl = waveformBounds?.left ?? 228
                const wr = waveformBounds?.right ?? 68
                return (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: wl, right: wr,
                    pointerEvents: 'none', zIndex: 4,
                  }}>
                    {[...new Set(sections.flatMap(s => [
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
                <div className="px-[22px] py-12 text-center text-[13px] text-dim">No tracks yet — add one below</div>
              ) : activeTracks.map((t, i) => (
                <TrackRow
                  key={t.id} track={t} index={i}
                  muted={player.mutedTracks.has(t.id)} changed={isChanged(t)}
                  currentTimeMs={player.currentTime * 1000}
                  commentMode={commentMode} activeInput={activeCommentInput}
                  audioReady={player.loaded >= player.total && player.total > 0}
                  onToggleMute={() => player.toggleMute(t.id)}
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
                />
              ))}
              {/* Skeleton track rows for DnD uploads */}
              {skeletonTracks.map(s => (
                <SkeletonTrackRow
                  key={s.id}
                  name={s.name}
                  progress={s.progress}
                  error={s.error}
                  errorMsg={s.errorMsg}
                  onRetry={() => {/* retry handled by re-triggering upload */}}
                />
              ))}
            </div>

            <div className="px-[22px] py-3"
              onDragOver={handleAddRowDragOver}
              onDragLeave={handleAddRowDragLeave}
              onDrop={handleAddRowDrop}
            >
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg transition-colors duration-150 disabled:cursor-not-allowed"
                style={{
                  border: isDraggingAddRow ? '0.5px dashed var(--accent)' : '0.5px dashed var(--border-light)',
                  background: isDraggingAddRow ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                  color: isDraggingAddRow ? 'var(--accent)' : 'var(--text-dim)',
                }}
                onMouseEnter={e => { if (!isDraggingAddRow) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                onMouseLeave={e => { if (!isDraggingAddRow) { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-dim)' } }}
              >
                {isDraggingAddRow ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 2v6M2 6l4-4 4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 10h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                )}
                <span className="text-[12px]">
                  {isDraggingAddRow ? 'Drop to add track' : uploading ? 'Uploading…' : 'Add track (WAV / MP3 / MIDI)'}
                </span>
              </button>
              {dndProgress && dndProgress.total > 1 && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-dim)' }}>
                  Uploading {dndProgress.done + 1} of {dndProgress.total} files…
                </p>
              )}
              <input ref={fileInputRef} type="file"
                accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
                multiple className="hidden" onChange={handleAddTrack}
              />
            </div>

          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-[22px] py-3 shrink-0" style={{ borderTop: '0.5px solid var(--border)' }}>
            <div className="flex items-center gap-5">
              {project.bpm && <span className="text-[11px] text-dim">BPM <span className="text-soft font-medium">{project.bpm}</span></span>}
              {project.key && <span className="text-[11px] text-dim">Key <span className="text-soft font-medium">{project.key}</span></span>}
              <span className="text-[11px] text-dim">Tracks <span className="text-soft font-medium">{activeTracks.length}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setCommentMode(m => !m); setActiveCommentInput(null) }}
                className={`inline-flex items-center gap-1.5 px-3 h-[34px] rounded-lg text-[12px] font-medium transition-all duration-150 ${commentMode ? 'btn-accent' : 'btn-topbar'}`}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 2.5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 11 2.5v5A1.5 1.5 0 0 1 9.5 9H5L1 11V2.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round"/></svg>
                {commentMode ? 'Exit comments' : `Comments${totalComments > 0 ? ` (${totalComments})` : ''}`}
              </button>
            </div>
          </div>

          </div>{/* end content dim wrapper */}
        </main>
      </div>

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
      {toast && createPortal(
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9000] px-4 py-2.5 rounded-xl text-[12px] font-medium flex items-center gap-2 pointer-events-none"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border-light)',
            color: 'var(--text-soft)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            animation: 'toast-in 0.2s ease',
          }}
        >
          <span style={{ color: 'var(--green)' }}>✓</span>
          {toast}
        </div>,
        document.body
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { TrackComment, Track, Version, Project } from '@/lib/types'
import { useVersionCache } from '@/hooks/useVersionCache'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { resolveTrackIconColor } from '@/lib/trackIcon'
import { MergeModal } from './MergeModal'
import type { MergePreview } from './MergeModal'
import { BrandSpinner } from '@/components/BrandSpinner'
import { ResourcesCard } from '@/components/ResourcesCard'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { ProjectSidebarResources } from '@/components/ProjectSidebarResources'

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
// Both live at module scope so they survive component unmount/remount (version
// switches) for the lifetime of the browser tab.

/** Decoded waveform bar amplitudes per track ID (72 floats, normalised 0–1). */
const waveformBarsCache = new Map<string, number[]>()

/** Raw audio ArrayBuffer per track ID.  decodeAudioData() detaches the buffer,
 *  so callers must use .slice(0) to get a fresh copy before decoding. */
const audioArrayBufferCache = new Map<string, ArrayBuffer>()

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
  comment, anchorLeft, anchorTop, onDelete, onHide,
}: {
  comment: TrackComment
  anchorLeft: number
  anchorTop: number
  onDelete: (id: string) => void
  onHide: () => void
}) {
  const W = 224
  let left = anchorLeft - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
  const caretLeft = Math.max(8, Math.min(W - 12, anchorLeft - left))

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
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-accent tabular-nums">
            {fmtMs(comment.timecode_start_ms)} → {fmtMs(comment.timecode_end_ms)}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(comment.id) }}
            className="text-[12px] text-dim hover:text-danger transition-colors duration-150 px-0.5 leading-none"
          >✕</button>
        </div>
        <p className="text-[12px] text-soft leading-snug break-words">{comment.content}</p>
      </div>
    </div>,
    document.body
  )
}

// ─── Comment range marker ─────────────────────────────────────────────────────

function CommentRangeMarker({ comment, durationMs, dotTopOffset, commentMode, onDelete }: {
  comment: TrackComment
  durationMs: number
  dotTopOffset: number
  commentMode: boolean
  onDelete: (id: string) => void
}) {
  const startPct = durationMs > 0 ? (comment.timecode_start_ms / durationMs) * 100 : 0
  const endPct = durationMs > 0 ? (comment.timecode_end_ms / durationMs) * 100 : 0
  const widthPct = Math.max(endPct - startPct, 0)
  const isNarrow = widthPct < 3

  const [showTooltip, setShowTooltip] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleHide = () => { hideTimer.current = setTimeout(() => setShowTooltip(false), 120) }
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  function getAnchor() {
    const r = rangeRef.current?.getBoundingClientRect()
    if (!r) return { left: 0, top: 0 }
    return isNarrow
      ? { left: r.left, top: r.top }
      : { left: r.left + r.width / 2, top: r.top }
  }

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
        style={{ background: showTooltip ? 'rgba(99, 102, 241, 0.18)' : 'rgba(99, 102, 241, 0.08)' }}
      />
      {/* Left edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150"
        style={{ left: 0, width: 1.5, background: '#6366F1', opacity: showTooltip ? 1.0 : 0.5 }}
      />
      {/* Right edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150"
        style={{ right: 0, width: 1.5, background: '#6366F1', opacity: showTooltip ? 1.0 : 0.5 }}
      />
      {showTooltip && (() => {
        const { left, top } = getAnchor()
        return (
          <CommentTooltip
            comment={comment}
            anchorLeft={left}
            anchorTop={top}
            onDelete={onDelete}
            onHide={scheduleHide}
          />
        )
      })()}
    </div>
  )
}

// ─── Comment input bubble (portal) ────────────────────────────────────────────

function CommentInputBubble({ input, onSubmit, onClose }: {
  input: ActiveCommentInput
  onSubmit: (content: string) => Promise<void>
  onClose: () => void
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
  commentMode, comments, activeInput,
  onSeek, onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput, onReady,
}: {
  trackId: string; muted: boolean; playedRatio: number; color: string; durationMs: number
  commentMode: boolean; comments: TrackComment[]; activeInput: ActiveCommentInput | null
  onSeek: (t: number) => void
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onReady?: () => void
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>([])
  const [ready, setReady] = useState(false)
  const [animProgress, setAnimProgress] = useState(0) // 0 = flat dots, 1 = full bars
  const animRafRef = useRef(0)
  const [mouseRatio, setMouseRatio] = useState<number | null>(null)

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
  }, [animProgress, muted, playedRatio, color, isDark])

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
    if (commentMode) {
      if (dragRef.current?.active) {
        const pct = Math.max(0, Math.min(1, getXPercent(e.clientX)))
        dragRef.current.currentPct = pct
        setDragRect({ startX: dragRef.current.startPct, endX: pct })
      }
      return
    }
    setMouseRatio(getXPercent(e.clientX))
  }

  function handleMouseLeave() {
    // If dragging, let the window listener handle finalization on mouseup
    setMouseRatio(null)
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
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={e => { if (!commentMode) onSeek((getXPercent(e.clientX) * durationMs) / 1000) }}
    >
      {/* z-index 1: waveform bars (dots while loading, grows to full on ready) */}
      <canvas ref={canvasRef} className="w-full block relative z-[1]" style={{ height: 34 }} />

      {/* z-index 2: seek hover line (non-comment mode only) */}
      {mouseRatio !== null && !commentMode && !thisInputActive && (
        <div
          className="absolute top-0 bottom-0 w-px z-[2] pointer-events-none -translate-x-1/2"
          style={{ left: `${mouseRatio * 100}%`, background: 'var(--text-muted)', opacity: 0.5 }}
        />
      )}

      {/* z-index 3: saved comment ranges */}
      {comments.map(c => (
        <CommentRangeMarker
          key={c.id}
          comment={c}
          durationMs={durationMs}
          dotTopOffset={overlapOffsets.get(c.id) ?? 0}
          commentMode={commentMode}
          onDelete={onCommentDelete}
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
        />
      )}
    </div>
  )
}

// ─── Player hook ──────────────────────────────────────────────────────────────

function usePlayer(tracks: Track[], versionId: string) {
  const actxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const bufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  const startRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!tracks.length) return
    let cancelled = false
    const ctx = new AudioContext()
    actxRef.current = ctx
    bufsRef.current = new Map()
    setLoaded(0)
    let maxDur = 0
    Promise.all(tracks.map(async t => {
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
        if (!cancelled) { bufsRef.current.set(t.id, decoded); maxDur = Math.max(maxDur, decoded.duration); setLoaded(c => c + 1) }
      } catch { /* skip */ }
    })).then(() => { if (!cancelled) setDuration(maxDur) })
    return () => { cancelled = true; ctx.close(); cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId])

  const stopSources = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
  }, [])

  const play = useCallback(async (offset = offsetRef.current) => {
    const ctx = actxRef.current
    if (!ctx) return
    stopSources()
    if (ctx.state === 'suspended') await ctx.resume()
    const newGains = new Map<string, GainNode>()
    bufsRef.current.forEach((buf, id) => {
      const g = ctx.createGain()
      g.gain.value = mutedTracks.has(id) ? 0 : 1
      g.connect(ctx.destination)
      newGains.set(id, g)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(g)
      src.start(0, offset)
      sourcesRef.current.push(src)
    })
    gainsRef.current = newGains
    startRef.current = ctx.currentTime - offset
    offsetRef.current = offset
    setPlaying(true)
    const dur = duration || 1
    const tick = () => {
      const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
      if (elapsed >= dur) { setPlaying(false); setCurrentTime(0); offsetRef.current = 0; return }
      setCurrentTime(elapsed)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [mutedTracks, duration, stopSources])

  const pause = useCallback(() => {
    offsetRef.current = (actxRef.current?.currentTime ?? 0) - startRef.current
    stopSources(); setPlaying(false)
  }, [stopSources])

  const seek = useCallback((t: number) => {
    offsetRef.current = t
    if (playing) play(t)
    else setCurrentTime(t)
  }, [playing, play])

  const toggleMute = useCallback((id: string) => {
    setMutedTracks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      const g = gainsRef.current.get(id)
      if (g) g.gain.value = next.has(id) ? 0 : 1
      return next
    })
  }, [])

  return { playing, currentTime, duration, loaded, total: tracks.length, mutedTracks, play: () => play(), pause, seek, toggleMute }
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

// ─── TrackRow ─────────────────────────────────────────────────────────────────

function TrackRow({
  track, index, muted, changed, playedRatio, durationMs,
  commentMode, activeInput,
  onToggleMute, onReplace, onSeek,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput,
  onDeleteTrack,
}: {
  track: Track; index: number; muted: boolean; changed: boolean
  playedRatio: number; durationMs: number; commentMode: boolean
  activeInput: ActiveCommentInput | null
  onToggleMute: () => void; onReplace: (f: File) => void; onSeek: (t: number) => void
  onCommentPlace: (input: ActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onDeleteTrack: (trackId: string) => Promise<void>
}) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const fileRef = useRef<HTMLInputElement>(null)
  const col = palette(index)
  const iconBg = isDark ? resolveTrackIconColor(col.bg, true) : col.bgLight
  const instrument = detectInstrument(track.name)

  const [waveformReady, setWaveformReady] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [rowHovered, setRowHovered] = useState(false)

  const rowBg = deleteError
    ? 'rgba(239,68,68,0.12)'
    : confirmDelete
    ? 'rgba(239,68,68,0.06)'
    : rowHovered && !commentMode
    ? 'var(--bg-surface)'
    : 'transparent'

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
    <div
      className="relative grid items-center h-[62px] gap-3 px-[22px] overflow-visible"
      style={{
        gridTemplateColumns: '20px 32px 118px 1fr 22px auto',
        background: rowBg,
        boxShadow: confirmDelete || deleteError ? 'inset 0 0 0 0.5px rgba(239,68,68,0.2)' : 'none',
        borderBottom: '0.5px solid var(--border)',
        transition: 'background 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={() => setRowHovered(true)}
      onMouseLeave={() => setRowHovered(false)}
    >
      <span className="text-center text-[11px] text-dim tabular-nums">{index + 1}</span>

      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: iconBg }}>
        {waveformReady ? (
          <InstrumentSVG type={instrument} color={col.fg} />
        ) : (
          <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke={col.fg} strokeWidth="1.5" strokeOpacity="0.2" />
            <path d="M6.5 1.5A5 5 0 0 1 11.5 6.5" stroke={col.fg} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-[13px] text-soft truncate">{track.name}</div>
        <div className="mt-0.5">
          {changed ? (
            <span className="text-[10px] text-amber flex items-center gap-1">
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><circle cx="2" cy="2" r="1" fill="currentColor" /><circle cx="7" cy="2" r="1" fill="currentColor" /><circle cx="2" cy="7" r="1" fill="currentColor" /><path d="M3 2h3M2 3v3M7 3l-5 5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" /></svg>
              modified
            </span>
          ) : (
            <span className="text-[11px] text-dim truncate block">
              {track.original_filename ?? '—'}{track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="relative min-w-0 overflow-visible">
        <Waveform
          trackId={track.id} muted={muted} playedRatio={playedRatio} color={col.fg}
          durationMs={durationMs} commentMode={commentMode} comments={track.comments ?? []}
          activeInput={activeInput} onSeek={onSeek} onCommentPlace={onCommentPlace}
          onCommentDelete={onCommentDelete} onCommentCreate={onCommentCreate} onCloseInput={onCloseInput}
          onReady={() => setWaveformReady(true)}
        />
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
        accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg,audio/mp3"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = '' }}
      />
    </div>
  )
}

// ─── Player bar ───────────────────────────────────────────────────────────────

function PlayerBar({ playing, currentTime, duration, loaded, total, onPlay, onPause, onSeek }: {
  playing: boolean; currentTime: number; duration: number; loaded: number; total: number
  onPlay: () => void; onPause: () => void; onSeek: (t: number) => void
}) {
  const pct = duration > 0 ? currentTime / duration : 0
  const [dragging, setDragging] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)

  function posToTime(clientX: number) {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
  }

  const isLoading = loaded < total && total > 0

  return (
    <div className="flex items-center h-[52px] shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
      {/* Play button — flush to left edge */}
      <button onClick={playing ? onPause : onPlay} disabled={total === 0} className="btn-play" style={{ flexShrink: 0, marginLeft: 0 }}>
        {isLoading ? (
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
            <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="2" width="3.5" height="10" rx="1" /><rect x="8.5" y="2" width="3.5" height="10" rx="1" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3.5 2l8 5-8 5V2z" /></svg>
        )}
      </button>

      {/* Combined time */}
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
        <div className="w-full rounded-full relative" style={{ height: 4, background: 'var(--border-light)' }}>
          <div className="h-full rounded-full relative" style={{ width: `${pct * 100}%`, background: 'var(--accent)' }}>
            <div className="absolute top-1/2 rounded-full bg-white" style={{ right: -5, width: 10, height: 10, transform: 'translateY(-50%)', boxShadow: '0 0 0 2px rgba(99,102,241,0.3)' }} />
          </div>
        </div>
      </div>

      {/* Volume icon — flush right */}
      <button className="text-dim hover:text-muted transition-colors duration-150 p-1" title="Volume">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
          <path d="M10 4.5a3 3 0 0 1 0 5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      </button>
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

function Sidebar({ versions, activeId, onSelect, onNewBranch, onMerge, mergeCheckingId, storageUsed, storageLimit, projectId, projectName }: {
  versions: Version[]; activeId: string
  onSelect: (id: string) => void; onNewBranch: () => void; onMerge: (id: string) => void
  mergeCheckingId: string | null
  storageUsed: number
  storageLimit: number
  projectId: string
  projectName: string
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

      <ProjectSidebarResources projectId={projectId} projectName={projectName} />

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
  const { id: projectId } = useParams<{ id: string }>()
  const cache = useVersionCache()

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

  const activeVersion = versions.find(v => v.id === activeVersionId)
  const activeTracks = activeVersion?.tracks ?? []
  const canSaveVersion = activeVersion?.type === 'branch' && !activeVersion.merged_at
  const isSaveVersionChecking = mergeCheckingId === activeVersionId
  const mainVersion = versions.find(v => v.type === 'main')
  const mainHashes = new Set((mainVersion?.tracks ?? []).map(t => t.file_hash))
  const isChanged = (t: Track) => !!mainVersion && activeVersionId !== mainVersion.id && !mainHashes.has(t.file_hash)

  const player = usePlayer(activeTracks, activeVersionId)
  const playedRatio = player.duration > 0 ? player.currentTime / player.duration : 0
  const durationMs = player.duration * 1000

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

  async function handleAddTrack(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length || !activeVersionId) return
    e.target.value = ''
    setUploading(true)
    const errors: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fd = new FormData()
        fd.append('file', file)
        fd.append('name', file.name.replace(/\.[^/.]+$/, ''))
        fd.append('position', String(activeTracks.length + i))
        const res = await fetch(`/api/versions/${activeVersionId}/tracks/upload`, { method: 'POST', body: fd })
        if (!res.ok) errors.push(`${file.name}: ${(await res.json()).error ?? res.statusText}`)
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

  const totalComments = activeTracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)

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
        <a href="/" className="flex items-center no-underline mr-1.5">
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text-sec)' }}>track</span>
          <span className="text-[14px] font-semibold text-accent tracking-tight">base</span>
        </a>
        <span className="text-lg leading-none" style={{ color: 'var(--border-light)' }}>·</span>
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>The Noise</span>
        <span className="text-sm" style={{ color: 'var(--border-light)' }}>/</span>
        <span className="text-[13px]" style={{ color: 'var(--text-sec)' }}>{project.name}</span>
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
        <button
          onClick={() => canSaveVersion && handleMergeClick(activeVersionId)}
          disabled={!canSaveVersion || isSaveVersionChecking}
          className="btn-accent"
          title={canSaveVersion ? 'Merge this branch into main' : 'Switch to a branch to merge changes into main'}
          style={{
            opacity: !canSaveVersion ? 0.45 : 1,
            cursor: !canSaveVersion ? 'not-allowed' : isSaveVersionChecking ? 'wait' : 'pointer',
          }}
        >
          {isSaveVersionChecking ? (
            <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
              <path d="M6.5 2A4.5 4.5 0 0 1 11 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 11V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4 6h5M4 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
          )}
          {isSaveVersionChecking ? 'Checking…' : 'Save version'}
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
          projectId={projectId}
          projectName={project.name}
        />

        <main className="flex flex-col flex-1 overflow-hidden min-w-0" style={{ background: 'var(--bg)' }}>

          {/* Project header */}
          <div className="px-[22px] pt-4 pb-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
            <h1 className="text-[17px] font-medium text-bright">{project.name}</h1>
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

          <PlayerBar playing={player.playing} currentTime={player.currentTime} duration={player.duration} loaded={player.loaded} total={player.total} onPlay={player.play} onPause={player.pause} onSeek={player.seek} />

          {/* Comment mode banner */}
          <div className={`overflow-hidden transition-[height,opacity] duration-200 ${commentMode ? 'h-[34px] opacity-100' : 'h-0 opacity-0'}`}>
            <div className="flex items-center gap-2 px-[22px] h-[34px]" style={{ background: 'rgba(217,119,6,0.06)', borderBottom: '0.5px solid var(--border)' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="var(--amber)" strokeWidth="1"/><path d="M5 3v2.5M5 7v.5" stroke="var(--amber)" strokeWidth="1" strokeLinecap="round"/></svg>
              <span className="text-[11px] text-amber">Comment mode — drag on any waveform to select a time range</span>
            </div>
          </div>

          {/* Track list */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="grid gap-3 px-[22px] py-2.5" style={{ gridTemplateColumns: '20px 32px 118px 1fr 22px auto', borderBottom: '0.5px solid var(--border)' }}>
              {['#', '', 'Track', 'Waveform', '', ''].map((h, i) => (
                <span key={i} className="text-[10px] text-dim font-medium uppercase tracking-widest">{h}</span>
              ))}
            </div>

            {versionLoading ? (
              <BrandSpinner fullscreen={false} />
            ) : activeTracks.length === 0 ? (
              <div className="px-[22px] py-12 text-center text-[13px] text-dim">No tracks yet — add one below</div>
            ) : activeTracks.map((t, i) => (
              <TrackRow
                key={t.id} track={t} index={i}
                muted={player.mutedTracks.has(t.id)} changed={isChanged(t)}
                playedRatio={playedRatio} durationMs={durationMs}
                commentMode={commentMode} activeInput={activeCommentInput}
                onToggleMute={() => player.toggleMute(t.id)}
                onReplace={f => handleReplaceTrack(t, f)}
                onSeek={player.seek}
                onCommentPlace={setActiveCommentInput}
                onCommentDelete={handleCommentDelete}
                onCommentCreate={handleCommentCreate}
                onCloseInput={() => setActiveCommentInput(null)}
                onDeleteTrack={handleDeleteTrack}
              />
            ))}

            <div className="px-[22px] py-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-dim hover:text-muted transition-colors duration-150 disabled:cursor-not-allowed"
                style={{ border: '0.5px dashed var(--border-light)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)' }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                <span className="text-[12px]">{uploading ? 'Uploading…' : 'Add track (WAV / MP3)'}</span>
              </button>
              <input ref={fileInputRef} type="file"
                accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg,audio/mp3"
                multiple className="hidden" onChange={handleAddTrack}
              />
            </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-[22px] py-3 shrink-0" style={{ borderTop: '0.5px solid var(--border)' }}>
            <div className="flex items-center gap-5 flex-wrap">
              {project && (
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                />
              )}
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

          {/* Resources */}
          <div className="px-[22px] pb-8">
            <ResourcesCard projectId={projectId} projectName={project.name} />
          </div>
        </div>
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

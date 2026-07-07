'use client'

/**
 * Edit-mode waveform area for a single track row in the desktop mixer.
 *
 * Replaces the normal waveform clip while a track is in edit mode:
 *  - bar-snapped selection by dragging across the waveform
 *  - bar-snapped playhead placement by clicking
 *  - per-segment drag handles (top strip) to move segments
 *  - per-segment edge thumbs to trim or extend trimmed audio
 *  - right-click context menu + keyboard shortcuts for edit operations
 *
 * All state lives in the parent's TrackEditSession — this component is purely
 * presentational + interaction plumbing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type TrackEditSession,
  type EditSelection,
  canSplitAtBar,
  canRemoveSelection,
  clampSegmentStart,
  clampSegmentStartEdge,
  clampSegmentEndEdge,
  segmentAtBar,
  segmentDisplays,
  segmentLenBars,
  segmentWaveformBars,
  previewTrimmedSegment,
} from '@/lib/trackEdit'
import { waveformBarsCache } from '@/lib/waveformCache'
import { WaveformBarsPlayhead } from '@/components/WaveformBars'

// ─── Small icons (match the app's thin-stroke style) ──────────────────────────

export function PencilIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.3 1.7l2 2L4 10H2v-2l6.3-6.3z" />
    </svg>
  )
}

export function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 6.5L4.8 9.2 10 3.5" />
    </svg>
  )
}

export function XIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  )
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

export function TrackEditConfirmModal({
  title,
  body,
  cancelLabel,
  confirmLabel,
  danger = false,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  cancelLabel: string
  confirmLabel: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8500] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md border border-border bg-popover p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <p className="font-display text-lg uppercase tracking-tight text-foreground mb-3 m-0">
          {title}
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed m-0">{body}</p>
        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest px-3 py-1.5 border font-display font-bold transition ${
              danger
                ? 'border-destructive bg-destructive text-white'
                : 'border-lime bg-lime text-primary-foreground'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface MenuItem {
  label: string
  shortcut: string
  disabled: boolean
  disabledReason?: string
  onClick: () => void
}

function EditContextMenu({
  x, y, items, onClose,
}: {
  x: number
  y: number
  items: (MenuItem | 'divider')[]
  onClose: () => void
}) {
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', close)
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed z-[9000] min-w-[200px] border border-border bg-popover shadow-2xl py-1"
      style={{
        left: Math.min(x, typeof window !== 'undefined' ? window.innerWidth - 220 : x),
        top: Math.min(y, typeof window !== 'undefined' ? window.innerHeight - items.length * 30 - 16 : y),
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={`div-${i}`} className="my-1 border-t border-border/60" />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
            className={`w-full flex items-center justify-between gap-4 px-3 py-1.5 text-left text-[10px] uppercase tracking-widest transition ${
              item.disabled
                ? 'text-muted-foreground/40 cursor-default'
                : 'text-foreground hover:bg-surface hover:text-lime'
            }`}
          >
            <span>{item.label}</span>
            <span className={item.disabled ? 'text-muted-foreground/30' : 'text-muted-foreground'}>
              {item.shortcut}
            </span>
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

// ─── Edit area ────────────────────────────────────────────────────────────────

const SELECT_THRESHOLD_PX = 4
const HANDLE_H = 7
const TRIM_THUMB_W = 10
const SEG_TOP_RADIUS = 4

function TrimThumb({
  side,
  onMouseDown,
}: {
  side: 'left' | 'right'
  onMouseDown: (e: React.MouseEvent) => void
}) {
  const isLeft = side === 'left'
  return (
    <div
      title="Drag to trim or extend"
      onMouseDown={onMouseDown}
      className="absolute top-0 bottom-0 z-[3] cursor-ew-resize"
      style={{
        [isLeft ? 'left' : 'right']: 0,
        width: TRIM_THUMB_W,
        opacity: 0.42,
        background: 'color-mix(in srgb, var(--lime) 40%, transparent)',
        borderRight: isLeft
          ? '1px solid color-mix(in srgb, var(--lime) 35%, transparent)'
          : undefined,
        borderLeft: !isLeft
          ? '1px solid color-mix(in srgb, var(--lime) 35%, transparent)'
          : undefined,
        borderBottomLeftRadius: isLeft ? SEG_TOP_RADIUS : 0,
        borderBottomRightRadius: isLeft ? 0 : SEG_TOP_RADIUS,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="absolute pointer-events-none opacity-90"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
        }}
      >
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="rounded-full bg-lime shrink-0"
            style={{ width: 3, height: 3 }}
          />
        ))}
      </div>
    </div>
  )
}

export function TrackEditArea({
  session,
  color,
  labelW,
  rowH,
  totalBars,
  barDurationMs,
  totalDurationMs,
  currentTimeRef,
  applyStatus,
  applyError,
  onSeekBar,
  onSelect,
  onSeparate,
  onRemove,
  onDuplicate,
  onCopy,
  onPaste,
  onMoveSegment,
  onTrimSegmentStart,
  onTrimSegmentEnd,
  onUndo,
  onRedo,
  onRequestCancel,
  onRetryApply,
}: {
  session: TrackEditSession
  color: string
  labelW: number
  rowH: number
  totalBars: number
  barDurationMs: number
  totalDurationMs?: number
  currentTimeRef: React.RefObject<number>
  applyStatus: 'idle' | 'processing' | 'error'
  applyError?: string | null
  onSeekBar: (bar: number) => void
  onSelect: (sel: EditSelection | null) => void
  onSeparate: (playheadBar: number) => void
  onRemove: () => void
  onDuplicate: () => void
  onCopy: () => void
  onPaste: (playheadBar: number) => void
  onMoveSegment: (segId: string, newStartBar: number) => void
  onTrimSegmentStart: (segId: string, newStartBar: number) => void
  onTrimSegmentEnd: (segId: string, newEndBar: number) => void
  onUndo: () => void
  onRedo: () => void
  onRequestCancel: () => void
  onRetryApply: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live drag previews
  const [movePreview, setMovePreview] = useState<{ segId: string; startBar: number } | null>(null)
  const [trimPreview, setTrimPreview] = useState<{ segId: string; startBar?: number; endBar?: number } | null>(null)
  const [dragSel, setDragSel] = useState<EditSelection | null>(null)
  const [activeInteraction, setActiveInteraction] = useState<'none' | 'select' | 'move' | 'trim' | 'area'>('none')
  const [timelineWidthPx, setTimelineWidthPx] = useState(0)
  const dragSelRef = useRef<EditSelection | null>(null)

  const sessionRef = useRef(session)
  sessionRef.current = session

  const barDurSec = barDurationMs / 1000

  const showHint = useCallback((msg: string) => {
    setHint(msg)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 1800)
  }, [])
  useEffect(() => () => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
  }, [])

  // Bar → fraction of the waveform column width (matches TactGrid / ruler math).
  const fracForBar = useCallback((bar: number): number => {
    if (barDurationMs && totalDurationMs && totalDurationMs > 0) {
      return (bar * barDurationMs) / totalDurationMs
    }
    return totalBars > 0 ? bar / totalBars : 0
  }, [barDurationMs, totalDurationMs, totalBars])

  const exactBarForClientX = useCallback((clientX: number): number => {
    const el = containerRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    if (barDurationMs && totalDurationMs && totalDurationMs > 0) {
      return (frac * totalDurationMs) / barDurationMs
    }
    return frac * totalBars
  }, [barDurationMs, totalDurationMs, totalBars])

  const getPlayheadBar = useCallback((): number => {
    const t = currentTimeRef.current ?? 0
    return Math.max(0, Math.floor(t / barDurSec + 1e-6))
  }, [currentTimeRef, barDurSec])

  // Focus the area when entering edit mode so shortcuts work immediately.
  useEffect(() => {
    containerRef.current?.focus()
  }, [session.trackId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setTimelineWidthPx(entries[0]?.contentRect.width ?? 0)
    })
    ro.observe(el)
    setTimelineWidthPx(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const beginPointerInteraction = useCallback((kind: 'select' | 'move' | 'trim' | 'area') => {
    setActiveInteraction(kind)
    onSelect(null)
    setDragSel(null)
    dragSelRef.current = null
  }, [onSelect])

  const endPointerInteraction = useCallback(() => {
    setActiveInteraction('none')
  }, [])

  // ── Playhead line + per-segment played fraction (rAF, DOM-direct) ───────────
  const playheadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = containerRef.current
      const line = playheadRef.current
      if (el && line) {
        const t = currentTimeRef.current ?? 0
        const bar = barDurSec > 0 ? t / barDurSec : 0
        const frac = fracForBar(bar)
        line.style.left = `${Math.max(0, Math.min(100, frac * 100))}%`
        line.style.opacity = frac >= 0 && frac <= 1 ? '1' : '0'
        // Per-segment played pct for the bright waveform overlay
        el.querySelectorAll<HTMLElement>('[data-edit-seg]').forEach(segEl => {
          const start = parseFloat(segEl.dataset.segStart ?? '0')
          const len = parseFloat(segEl.dataset.segLen ?? '1')
          const pct = len > 0 ? Math.max(0, Math.min(100, ((bar - start) / len) * 100)) : 0
          segEl.style.setProperty('--played-pct', `${pct}%`)
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [barDurSec, fracForBar, currentTimeRef])

  // ── Selection / playhead drag ────────────────────────────────────────────────
  const selDragRef = useRef<{
    startClientX: number
    anchorExactBar: number
    segStartBar: number
    segEndBar: number
    active: boolean
  } | null>(null)

  const handleAreaMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || applyStatus === 'processing') return
    e.preventDefault()
    containerRef.current?.focus()
    beginPointerInteraction('area')
    const exact = exactBarForClientX(e.clientX)
    const seg = segmentAtBar(sessionRef.current.state, Math.floor(exact))
    selDragRef.current = {
      startClientX: e.clientX,
      anchorExactBar: exact,
      segStartBar: seg?.startBar ?? -1,
      segEndBar: seg ? seg.startBar + (seg.clips.reduce((s, c) => s + c.lenBars, 0)) : -1,
      active: false,
    }

    const onMove = (ev: MouseEvent) => {
      const d = selDragRef.current
      if (!d) return
      if (!d.active) {
        if (Math.abs(ev.clientX - d.startClientX) <= SELECT_THRESHOLD_PX) return
        d.active = true
        setActiveInteraction('select')
      }
      if (d.segStartBar < 0) return // drag started in silence — no selection
      const cur = exactBarForClientX(ev.clientX)
      let a = Math.round(Math.min(d.anchorExactBar, cur))
      let b = Math.round(Math.max(d.anchorExactBar, cur))
      // Clamp to the segment the drag started in (audio content only)
      a = Math.max(d.segStartBar, Math.min(d.segEndBar, a))
      b = Math.max(d.segStartBar, Math.min(d.segEndBar, b))
      const next = a < b ? { startBar: a, endBar: b } : null
      dragSelRef.current = next
      setDragSel(next)
    }

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const d = selDragRef.current
      selDragRef.current = null
      endPointerInteraction()
      if (!d) return
      if (!d.active) {
        // Plain click — move playhead to the start of the clicked bar, clear selection
        const bar = Math.max(0, Math.min(totalBars, Math.floor(exactBarForClientX(ev.clientX))))
        dragSelRef.current = null
        setDragSel(null)
        onSelect(null)
        onSeekBar(bar)
        return
      }
      onSelect(dragSelRef.current)
      dragSelRef.current = null
      setDragSel(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyStatus, exactBarForClientX, onSeekBar, onSelect, totalBars, beginPointerInteraction, endPointerInteraction])

  // ── Segment move drag (handle) ───────────────────────────────────────────────
  const handleSegmentHandleMouseDown = useCallback((e: React.MouseEvent, segId: string) => {
    if (e.button !== 0 || applyStatus === 'processing') return
    e.preventDefault()
    e.stopPropagation()
    containerRef.current?.focus()
    beginPointerInteraction('move')
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const barsPerPx = rect.width > 0
      ? (barDurationMs && totalDurationMs && totalDurationMs > 0
        ? totalDurationMs / barDurationMs
        : totalBars) / rect.width
      : 0
    const seg = sessionRef.current.state.segments.find(s => s.id === segId)
    if (!seg) return
    const origStart = seg.startBar
    const startX = e.clientX
    let lastPreview = origStart

    const onMove = (ev: MouseEvent) => {
      const desired = origStart + (ev.clientX - startX) * barsPerPx
      const clamped = clampSegmentStart(sessionRef.current.state, segId, desired)
      lastPreview = clamped
      setMovePreview({ segId, startBar: clamped })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setMovePreview(null)
      endPointerInteraction()
      if (lastPreview !== origStart) onMoveSegment(segId, lastPreview)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyStatus, barDurationMs, totalDurationMs, totalBars, onMoveSegment, beginPointerInteraction, endPointerInteraction])

  const handleTrimStartMouseDown = useCallback((e: React.MouseEvent, segId: string) => {
    if (e.button !== 0 || applyStatus === 'processing') return
    e.preventDefault()
    e.stopPropagation()
    containerRef.current?.focus()
    beginPointerInteraction('trim')
    const seg = sessionRef.current.state.segments.find(s => s.id === segId)
    if (!seg) return
    const origStart = seg.startBar
    let lastPreview = origStart

    const onMove = (ev: MouseEvent) => {
      const bar = exactBarForClientX(ev.clientX)
      const clamped = clampSegmentStartEdge(
        sessionRef.current.state,
        segId,
        bar,
        sessionRef.current.contentBars,
      )
      lastPreview = clamped
      setTrimPreview({ segId, startBar: clamped })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTrimPreview(null)
      endPointerInteraction()
      if (lastPreview !== origStart) onTrimSegmentStart(segId, lastPreview)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyStatus, exactBarForClientX, onTrimSegmentStart, beginPointerInteraction, endPointerInteraction])

  const handleTrimEndMouseDown = useCallback((e: React.MouseEvent, segId: string) => {
    if (e.button !== 0 || applyStatus === 'processing') return
    e.preventDefault()
    e.stopPropagation()
    containerRef.current?.focus()
    beginPointerInteraction('trim')
    const seg = sessionRef.current.state.segments.find(s => s.id === segId)
    if (!seg) return
    const origEnd = seg.startBar + seg.clips.reduce((s, c) => s + c.lenBars, 0)
    let lastPreview = origEnd

    const onMove = (ev: MouseEvent) => {
      const bar = exactBarForClientX(ev.clientX)
      const clamped = clampSegmentEndEdge(
        sessionRef.current.state,
        segId,
        bar,
        sessionRef.current.contentBars,
      )
      lastPreview = clamped
      setTrimPreview({ segId, endBar: clamped })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTrimPreview(null)
      endPointerInteraction()
      if (lastPreview !== origEnd) onTrimSegmentEnd(segId, lastPreview)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyStatus, exactBarForClientX, onTrimSegmentEnd, beginPointerInteraction, endPointerInteraction])

  // ── Operations with guard hints ──────────────────────────────────────────────
  const doSeparate = useCallback(() => {
    const bar = getPlayheadBar()
    if (!canSplitAtBar(sessionRef.current.state, bar)) {
      showHint('Position the playhead inside the audio to separate')
      return
    }
    onSeparate(bar)
  }, [getPlayheadBar, onSeparate, showHint])

  const doRemove = useCallback(() => {
    const sel = sessionRef.current.selection
    if (!canRemoveSelection(sessionRef.current.state, sel)) {
      showHint('Select bars first to remove')
      return
    }
    onRemove()
  }, [onRemove, showHint])

  const doDuplicate = useCallback(() => {
    if (!sessionRef.current.selection) {
      showHint('Select bars first to duplicate')
      return
    }
    onDuplicate()
  }, [onDuplicate, showHint])

  const doCopy = useCallback(() => {
    if (!sessionRef.current.selection) {
      showHint('Select bars first to copy')
      return
    }
    onCopy()
  }, [onCopy, showHint])

  const doPaste = useCallback(() => {
    if (!sessionRef.current.clipboard) {
      showHint('Copy a selection first to paste')
      return
    }
    onPaste(getPlayheadBar())
  }, [onPaste, getPlayheadBar, showHint])

  // ── Keyboard shortcuts (only while this row is focused) ──────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (applyStatus === 'processing') return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onRequestCancel()
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      e.stopPropagation()
      doRemove()
      return
    }
    if (!mod) return
    if (key === 'e') {
      e.preventDefault(); e.stopPropagation(); doSeparate()
    } else if (key === 'd') {
      e.preventDefault(); e.stopPropagation(); doDuplicate()
    } else if (key === 'c') {
      e.preventDefault(); e.stopPropagation(); doCopy()
    } else if (key === 'v') {
      e.preventDefault(); e.stopPropagation(); doPaste()
    } else if (key === 'z') {
      e.preventDefault(); e.stopPropagation()
      if (e.shiftKey) onRedo()
      else onUndo()
    } else if (key === 'y') {
      e.preventDefault(); e.stopPropagation(); onRedo()
    }
  }, [applyStatus, doSeparate, doRemove, doDuplicate, doCopy, doPaste, onUndo, onRedo, onRequestCancel])

  // ── Context menu ─────────────────────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (applyStatus === 'processing') return
    containerRef.current?.focus()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [applyStatus])

  const playheadBarNow = getPlayheadBar()
  const canSplit = canSplitAtBar(session.state, playheadBarNow)
  const canRemove = canRemoveSelection(session.state, session.selection)
  const hasSelection = session.selection != null
  const hasClipboard = session.clipboard != null

  // ── Rendering ────────────────────────────────────────────────────────────────
  const displays = useMemo(() => segmentDisplays(session.state), [session.state])
  const sourceBins = waveformBarsCache.get(session.trackId) ?? []
  const selection = activeInteraction === 'select'
    ? dragSel
    : activeInteraction === 'none'
      ? session.selection
      : null

  const timelineBarCount = barDurationMs && totalDurationMs && totalDurationMs > 0
    ? totalDurationMs / barDurationMs
    : totalBars
  const barWidthPx = timelineWidthPx > 0 && timelineBarCount > 0
    ? timelineWidthPx / timelineBarCount
    : 0

  const segmentWaveforms = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const d of displays) {
      const trim = trimPreview?.segId === d.id ? trimPreview : null
      const seg = trim
        ? previewTrimmedSegment(session.state, d.id, trim, session.contentBars)
        : session.state.segments.find(s => s.id === d.id)
      if (!seg) continue
      const contentLen = segmentLenBars(seg)
      const displayCount = Math.max(4, Math.round(96 * (contentLen / Math.max(1, totalBars))))
      map.set(
        trim ? `${d.id}:trim:${trim.startBar ?? ''}:${trim.endBar ?? ''}` : d.id,
        segmentWaveformBars(sourceBins, seg, session.contentBars, displayCount),
      )
    }
    return map
  }, [displays, session.state, session.contentBars, sourceBins, totalBars, trimPreview])

  const barLines = useMemo(() => {
    const lines: React.ReactNode[] = []
    for (let b = 1; b < totalBars; b++) {
      const heavy = b % 4 === 0
      lines.push(
        <div
          key={b}
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${fracForBar(b) * 100}%`,
            width: 0,
            borderLeft: heavy
              ? '1px solid color-mix(in srgb, var(--foreground) 22%, transparent)'
              : '1px solid color-mix(in srgb, var(--foreground) 10%, transparent)',
          }}
        />,
      )
    }
    return lines
  }, [totalBars, fracForBar])

  return (
    <div
      ref={containerRef}
      data-no-resource-filter
      tabIndex={0}
      role="application"
      aria-label="Track edit mode"
      className="absolute top-0 bottom-0 right-0 z-[2] outline-none overflow-hidden"
      style={{
        left: labelW,
        minHeight: rowH,
        background: 'color-mix(in srgb, var(--lime) 4%, transparent)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--lime) 45%, transparent)',
        cursor: applyStatus === 'processing' ? 'wait' : 'text',
      }}
      onMouseDown={handleAreaMouseDown}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      {/* Prominent bar grid */}
      {barLines}

      {/* Segments */}
      {displays.map(d => {
        const committedStart = d.startBar
        const committedLen = d.lenBars
        const committedEnd = committedStart + committedLen
        const moving = movePreview?.segId === d.id
        const trimming = trimPreview?.segId === d.id

        let layoutStart = committedStart
        let layoutEnd = committedEnd
        if (trimming && trimPreview) {
          if (trimPreview.startBar != null) layoutStart = trimPreview.startBar
          if (trimPreview.endBar != null) layoutEnd = trimPreview.endBar
        }

        const layoutLen = layoutEnd - layoutStart
        const moveOffsetPx = moving && movePreview
          ? (movePreview.startBar - committedStart) * barWidthPx
          : 0

        const left = trimming
          ? fracForBar(layoutStart) * 100
          : fracForBar(committedStart) * 100
        const width = trimming
          ? (fracForBar(layoutEnd) - fracForBar(layoutStart)) * 100
          : (fracForBar(committedEnd) - fracForBar(committedStart)) * 100

        const waveformKey = trimming && trimPreview
          ? `${d.id}:trim:${trimPreview.startBar ?? ''}:${trimPreview.endBar ?? ''}`
          : d.id
        const bars = segmentWaveforms.get(waveformKey)
          ?? segmentWaveforms.get(d.id)
          ?? []

        const playheadStart = moving && movePreview ? movePreview.startBar : layoutStart
        const playheadLen = moving ? committedLen : layoutLen

        return (
          <div
            key={d.id}
            data-edit-seg
            data-seg-start={playheadStart}
            data-seg-len={playheadLen}
            className="absolute top-0 bottom-0 overflow-hidden"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              padding: '0 1px',
              transform: moving ? `translateX(${moveOffsetPx}px)` : undefined,
              zIndex: moving || trimming ? 3 : 2,
              borderTopLeftRadius: SEG_TOP_RADIUS,
              borderTopRightRadius: SEG_TOP_RADIUS,
            }}
          >
            {/* Drag handle — move the whole segment; sits above side thumbs at the corner */}
            <div
              title="Drag to move"
              onMouseDown={e => handleSegmentHandleMouseDown(e, d.id)}
              className="absolute top-0 left-0 right-0 z-[4] cursor-grab active:cursor-grabbing"
              style={{
                height: HANDLE_H,
                background: 'color-mix(in srgb, var(--lime) 70%, transparent)',
                borderTopLeftRadius: SEG_TOP_RADIUS,
                borderTopRightRadius: SEG_TOP_RADIUS,
              }}
            />
            {/* Body — thumbs + waveform live below the top bar so corners stay clean */}
            <div
              className="absolute left-0 right-0 bottom-0 overflow-hidden"
              style={{ top: HANDLE_H }}
            >
              <TrimThumb side="left" onMouseDown={e => handleTrimStartMouseDown(e, d.id)} />
              <TrimThumb side="right" onMouseDown={e => handleTrimEndMouseDown(e, d.id)} />
              <div
                className="absolute inset-0 px-1 py-1.5 overflow-hidden"
                style={{
                  background: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
                  borderLeft: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)',
                  borderRight: '1px solid color-mix(in srgb, var(--lime) 35%, transparent)',
                }}
              >
                <div className="relative w-full h-full">
                  <WaveformBarsPlayhead
                    bars={bars}
                    color={color}
                    ready
                    animate={false}
                    className="h-full"
                  />
                </div>
              </div>
            </div>
            {(moving || trimming) && (
              <span
                className="absolute z-10 pointer-events-none text-[9px] font-mono tabular-nums whitespace-nowrap rounded px-1 py-px bg-lime text-primary-foreground"
                style={{ top: HANDLE_H + 2, left: 3, lineHeight: '1.3' }}
              >
                {moving && movePreview
                  ? (movePreview.startBar === 0 ? 'Bar 1' : `Bar ${movePreview.startBar + 1}`)
                  : `${layoutLen} bar${layoutLen !== 1 ? 's' : ''}`}
              </span>
            )}
          </div>
        )
      })}

      {/* Selection overlay */}
      {selection && (
        <div
          className="absolute top-0 bottom-0 z-[4] pointer-events-none"
          style={{
            left: `${fracForBar(selection.startBar) * 100}%`,
            width: `${(fracForBar(selection.endBar) - fracForBar(selection.startBar)) * 100}%`,
            background: 'color-mix(in srgb, var(--lime) 18%, transparent)',
            borderLeft: '1px solid var(--lime)',
            borderRight: '1px solid var(--lime)',
          }}
        >
          <span className="absolute top-[9px] left-1 text-[8px] font-mono tabular-nums text-lime bg-background/80 px-1 rounded">
            {selection.endBar - selection.startBar} bar{selection.endBar - selection.startBar !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Playhead line */}
      <div
        ref={playheadRef}
        className="absolute top-0 bottom-0 z-[5] pointer-events-none"
        style={{ left: 0, width: 0, borderLeft: '1px solid var(--foreground)' }}
      />

      {/* Transient hint tooltip */}
      {hint && (
        <div className="absolute z-[6] left-1/2 top-1.5 -translate-x-1/2 pointer-events-none text-[9px] uppercase tracking-widest px-2 py-1 bg-foreground text-background whitespace-nowrap">
          {hint}
        </div>
      )}

      {/* Apply progress / error */}
      {applyStatus === 'processing' && (
        <div className="absolute inset-0 z-[7] grid place-items-center bg-background/60">
          <div className="flex items-center gap-2">
            <div
              className="h-1 w-32 overflow-hidden rounded bg-border relative"
              role="progressbar"
              aria-label="Rendering edited track"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, var(--lime) 50%, transparent 100%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.2s infinite linear',
                }}
              />
            </div>
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Rendering edited track…
            </span>
          </div>
        </div>
      )}
      {applyStatus === 'error' && (
        <div className="absolute inset-x-0 bottom-0 z-[7] flex items-center gap-2 px-2 py-1 bg-destructive/10 border-t border-destructive/40">
          <span className="text-[9px] uppercase tracking-widest text-destructive truncate">
            {applyError ?? 'Apply failed'} — your edits are still here
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRetryApply() }}
            onMouseDown={e => e.stopPropagation()}
            className="ml-auto shrink-0 text-[9px] uppercase tracking-widest border border-destructive text-destructive px-1.5 py-0.5 hover:bg-destructive hover:text-white transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* Context menu */}
      {menu && (
        <EditContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Separate at playhead',
              shortcut: '⌘E',
              disabled: !canSplit,
              disabledReason: 'Playhead must be inside the audio content',
              onClick: doSeparate,
            },
            {
              label: 'Remove selection',
              shortcut: '⌫',
              disabled: !canRemove,
              disabledReason: 'Select a bar range first',
              onClick: doRemove,
            },
            'divider',
            {
              label: 'Copy selection',
              shortcut: '⌘C',
              disabled: !hasSelection,
              disabledReason: 'Select a bar range first',
              onClick: doCopy,
            },
            {
              label: 'Paste at playhead',
              shortcut: '⌘V',
              disabled: !hasClipboard,
              disabledReason: 'Copy a selection first',
              onClick: doPaste,
            },
            {
              label: 'Duplicate selection',
              shortcut: '⌘D',
              disabled: !hasSelection,
              disabledReason: 'Select a bar range first',
              onClick: doDuplicate,
            },
          ]}
        />
      )}
    </div>
  )
}

'use client'

// Track row: label column, waveform clip, offset drag, drawer, rename, piano roll.
// Extracted verbatim from page.tsx (behavior-preserving refactor).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Project, Track } from '@/lib/types'
import { usePaywallGate } from '@/contexts/PaywallContext'
import { PaywallLockWrap, paywallLockedButtonClass } from '@/components/paywall/PaywallLock'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { TactGrid } from '@/components/design/TactGrid'
import { Spinner } from '@/components/ui/Spinner'
import { TrackGainSlider } from '@/components/TrackGainSlider'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import PianoRollEditor from '@/components/PianoRollEditor'
import { getTrackIconSwatches, trackAccentColor } from '@/lib/trackIcon'
import { clampTrackStartBar, formatTrackStartBar } from '@/lib/trackMerge'
import { barOffsetToMs } from '@/lib/commentTimecodes'
import { MasterEditGuardCancelled } from '@/lib/masterEditGuard'
import { CheckIcon, PencilIcon, XIcon } from '@/components/TrackEditArea'
import { Waveform } from './Waveform'
import { isCommentUiTarget } from './commentLayer'
import { DownloadIcon, ReplaceIcon, TrackLetterBtn, TrashIcon } from './mixerChrome'
import {
  COMPACT_TRACK_ROW_H,
  TRACK_LABEL_W,
  TRACK_ROW_H,
  durationMsToBars,
  fmtSize,
  trackClipLeftPx,
  trackClipRowLeft,
  trackClipRowStyle,
  trackContentDurationMs,
} from './mixerUtils'
import type { ActiveCommentInput } from './mixerTypes'

// ─── Track color picker ───────────────────────────────────────────────────────

export function TrackColorPicker({ trackId, initialColor, onApply, onClose }: {
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

export const TrackRow = React.memo(function TrackRow({
  track, index, muted, soloed, changed, currentTimeRef,
  commentMode, activeInput, audioReady, midiRendering,
  onToggleMute, onToggleSolo, onReplace,
  trackGain, onTrackGainChange,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput,
  onDeleteTrack, onRenameTrack, onColorUpdate, onMidiDataUpdate, onStartBarUpdate,
  onDragStartOffset, onDragEndOffset, otherTrackDragging, waveformDimmed,
  waveformsInteractive = true,
  onSeek,
  currentUserId, isOwner, onReplyCreate, currentUser,
  projectId, versionId, project, totalBars, runtimeDurationMs,
  timelineDurationMs, onTrackDuration, waitForMidiRender,
  compact = false,
  resourceFilterActive = false,
  onResourceFilter,
  isReplacing = false,
  editable = false,
  editing: editMode = false,
  editBusy = false,
  onRequestEdit,
  onEditApply,
  onEditCancel,
  editArea,
}: {
  track: Track; index: number; muted: boolean; soloed: boolean; changed: boolean
  /** True while a new file is being uploaded/processed to replace this track. */
  isReplacing?: boolean
  /** Ref updated every rAF frame — read directly by DOM updates, never triggers re-render. */
  currentTimeRef: React.RefObject<number>; commentMode: boolean
  activeInput: ActiveCommentInput | null; audioReady: boolean
  midiRendering?: boolean
  onToggleMute: () => void; onToggleSolo: () => void; onReplace: (f: File) => void
  trackGain: number
  onTrackGainChange: (gain: number) => void
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
  /** Desktop mixer — click waveform to seek; dim unplayed region via --played-pct. */
  onSeek?: (timelineSec: number) => void
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
  /** Desktop mixer + audio track — show the Edit (pencil) button. */
  editable?: boolean
  /** True while THIS track is in edit mode. */
  editing?: boolean
  /** True while an edit apply is rendering/uploading. */
  editBusy?: boolean
  onRequestEdit?: () => void
  onEditApply?: () => void
  onEditCancel?: () => void
  /** Pre-built TrackEditArea element — replaces the waveform while editing. */
  editArea?: ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const accentColor = trackAccentColor(track.icon_color, index)
  const isMidi = track.file_type === 'midi'

  // All state/refs must come before computed values that read state
  const [waveformReady, setWaveformReady] = useState(false)
  useEffect(() => { setWaveformReady(false) }, [track.id])
  // Test-mode paywall — gates the Edit (pencil) entry point only
  const { locked: trackEditLocked, onLockedClick: onTrackEditLockedClick } = usePaywallGate('track_edit')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(false)
  const [rowHovered, setRowHovered] = useState(false)
  const [pianoRollOpen, setPianoRollOpen] = useState(false)
  // Drag-to-offset state
  const [isOffsetDragging, setIsOffsetDragging] = useState(false)
  const [offsetPointerDown, setOffsetPointerDown] = useState(false)
  const offsetDragActivatedRef = useRef(false)
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

  // Reset stale comment-UI lock when leaving comment mode (e.g. after posting a comment).
  useEffect(() => {
    if (!commentMode) {
      activeCommentInteractionsRef.current.clear()
      commentUiActiveRef.current = false
    }
  }, [commentMode])

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
    const wasActive = offsetDragActivatedRef.current
    setOffsetPointerDown(false)
    setIsOffsetDragging(false)
    if (wasActive) onDragEndOffset()
    offsetDragActivatedRef.current = false
    dragPreviewBarRef.current = null
    setDragPreviewBar(null)
    dragMovedRef.current = false
    resetLabelColOpacity()
  }

  // Cancel track-offset drag when the user interacts with portaled comment UI
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!isCommentUiTarget(e.target)) return
      if (isOffsetDragging || offsetPointerDown) cancelOffsetDrag()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffsetDragging, offsetPointerDown, onDragEndOffset])

  // Per-track offset and timing (uses dragPreviewBar state above)
  const projBpmRow = project.bpm ?? 120
  const projTimeSigRow = project.time_signature ?? '4/4'
  const beatsPerBarRow = parseInt(projTimeSigRow.split('/')[0]) || 4
  const barDurationMsRow = (60000 / projBpmRow) * beatsPerBarRow
  const effectiveStartBar = dragPreviewBar ?? (track.start_bar ?? 0)
  const savedTrackOffsetMs = barOffsetToMs(track.start_bar ?? 0, projBpmRow, projTimeSigRow)
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
  const playheadLayoutRef = useRef({ startBar: effectiveStartBar, durationBars: trackDurationBars, barDurSec: barDurationMsRow / 1000 })
  playheadLayoutRef.current = {
    startBar: effectiveStartBar,
    durationBars: trackDurationBars,
    barDurSec: barDurationMsRow / 1000,
  }

  const seekFromClientX = useCallback((clientX: number) => {
    if (!onSeek || commentMode || !waveformsInteractive) return
    const col = waveformColRef.current
    if (!col || !timelineDurationMs) return
    const rect = col.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onSeek(ratio * (timelineDurationMs / 1000))
  }, [onSeek, commentMode, waveformsInteractive, timelineDurationMs])

  // CSS playhead highlight — bright left of playhead, dim right (no playhead line on waveform).
  useEffect(() => {
    if (compact || !onSeek) return
    let raf: number
    function tick() {
      const target = waveformClipRef.current
      if (!target) {
        raf = requestAnimationFrame(tick)
        return
      }
      const { startBar, durationBars, barDurSec } = playheadLayoutRef.current
      const playheadBar = barDurSec > 0 ? (currentTimeRef.current ?? 0) / barDurSec : 0
      const pct = durationBars > 0
        ? Math.max(0, Math.min(100, ((playheadBar - startBar) / durationBars) * 100))
        : 0
      target.style.setProperty('--played-pct', `${pct}%`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, onSeek])

  async function snapStartBar(startBar: number) {
    if (startBar === (track.start_bar ?? 0)) return
    try {
      await onStartBarUpdate(track.id, startBar)
    } catch (err) {
      if (err instanceof MasterEditGuardCancelled) {
        const origBar = track.start_bar ?? 0
        dragPreviewBarRef.current = null
        setDragPreviewBar(null)
        if (waveformClipRef.current) {
          waveformClipRef.current.style.left = trackClipRowLeft(labelColW, totalBars, origBar)
        }
        syncSnapIndicator(origBar)
        resetLabelColOpacity()
      }
    }
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

  // Pointer down on waveform — offset drag UI only after movement past threshold.
  function beginOffsetPointer(clientX: number) {
    if (!waveformsInteractive || commentMode || commentUiActiveRef.current) return
    dragStartXRef.current = clientX
    dragMovedRef.current = false
    origStartBarRef.current = track.start_bar ?? 0
    offsetDragActivatedRef.current = false
    setOffsetPointerDown(true)
  }

  function activateOffsetDrag() {
    if (offsetDragActivatedRef.current) return
    offsetDragActivatedRef.current = true
    dragMovedRef.current = true
    const initialBar = origStartBarRef.current
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
    beginOffsetPointer(e.clientX)
  }

  function handleOffsetTouchStart(e: React.TouchEvent) {
    if (isCommentUiTarget(e.target) || commentUiActiveRef.current) return
    e.preventDefault()
    e.stopPropagation()
    beginOffsetPointer(e.touches[0].clientX)
  }

  useEffect(() => {
    if (!offsetPointerDown) return

    const DRAG_THRESHOLD_PX = 3
    const colEl = waveformColRef.current
    const containerWidth = colEl?.offsetWidth ?? 1
    const barsPerPixel = totalBars / containerWidth

    function applyDragPosition(clientX: number) {
      const deltaX = clientX - dragStartXRef.current
      if (!offsetDragActivatedRef.current) {
        if (Math.abs(deltaX) <= DRAG_THRESHOLD_PX) return
        activateOffsetDrag()
      }
      const newBar = clampTrackStartBar(
        origStartBarRef.current + deltaX * barsPerPixel,
        trackDurationBars,
      )
      dragPreviewBarRef.current = newBar
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

    function onDragEnd(e: MouseEvent | TouchEvent) {
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

      setOffsetPointerDown(false)

      if (!offsetDragActivatedRef.current) {
        const clientX = 'changedTouches' in e
          ? e.changedTouches[0]?.clientX
          : (e as MouseEvent).clientX
        if (clientX != null) seekFromClientX(clientX)
        return
      }

      setIsOffsetDragging(false)
      onDragEndOffset()
      offsetDragActivatedRef.current = false

      let newBar = dragPreviewBarRef.current
      if (newBar !== null) {
        newBar = clampTrackStartBar(newBar, trackDurationBars)
        dragPreviewBarRef.current = newBar
      }
      dragPreviewBarRef.current = null
      setDragPreviewBar(null)
      resetLabelColOpacity()
      if (newBar !== null && newBar !== (track.start_bar ?? 0)) {
        void snapStartBar(newBar)
      }
    }
    function onMouseUp(e: MouseEvent) { onDragEnd(e) }
    function onTouchEnd(e: TouchEvent) { onDragEnd(e) }
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
  }, [offsetPointerDown, totalBars, trackDurationBars, labelColW])

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
      setConfirmDelete(false)
    } catch (err) {
      setDeleting(false)
      if (err instanceof MasterEditGuardCancelled) {
        setConfirmDelete(false)
        return
      }
      setDeleteError(true)
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
        showColorPicker ? 'z-30' : editMode ? 'z-20' : ''
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
        className={`relative z-10 shrink-0 border-r border-border bg-background flex flex-col justify-between ${compact ? 'p-2 pr-5' : 'p-3 pr-5'} cursor-pointer`}
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
                  <span className="text-[8px] uppercase tracking-widest text-lime border border-lime/40 px-1 mr-1 shrink-0">
                    MIDI
                  </span>
                )}
              </div>
            )}
            {!compact && (
            <div className="mt-0.5">
              {isReplacing ? (
                <span className="inline-flex items-center gap-1.5 text-amber">
                  <Spinner size={10} tone="amber" />
                  <span className="text-[9px] uppercase tracking-widest">Replacing…</span>
                </span>
              ) : changed ? (
                <>
                  <span className="text-[9px] text-muted-foreground truncate block font-mono">
                    {track.original_filename ?? '—'}
                  </span>
                  <span className="text-[9px] uppercase tracking-widest text-amber">Modified</span>
                </>
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
          {editable && !isMidi && !compact && (
            trackEditLocked && !editMode ? (
              <PaywallLockWrap>
                <button
                  type="button"
                  onClick={onTrackEditLockedClick}
                  aria-label="Edit track"
                  className={`size-5 border text-[9px] grid place-items-center border-border text-muted-foreground ${paywallLockedButtonClass}`}
                >
                  <PencilIcon />
                </button>
              </PaywallLockWrap>
            ) : editMode ? (
              <>
                <HoverTooltip label={editBusy ? 'Rendering…' : 'Apply changes'}>
                  <button
                    type="button"
                    onClick={onEditApply}
                    disabled={editBusy}
                    aria-label="Apply track edits"
                    className="size-5 border grid place-items-center transition border-lime bg-lime text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckIcon />
                  </button>
                </HoverTooltip>
                <HoverTooltip label="Discard changes">
                  <button
                    type="button"
                    onClick={onEditCancel}
                    disabled={editBusy}
                    aria-label="Cancel track edits"
                    className="size-5 border grid place-items-center transition border-border text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <XIcon />
                  </button>
                </HoverTooltip>
              </>
            ) : (
              <HoverTooltip label={audioReady ? 'Edit track' : 'Loading audio…'}>
                <button
                  type="button"
                  onClick={onRequestEdit}
                  disabled={!audioReady || isReplacing}
                  aria-label="Edit track"
                  className="size-5 border text-[9px] grid place-items-center transition border-border hover:border-lime hover:text-lime text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground"
                >
                  <PencilIcon />
                </button>
              </HoverTooltip>
            )
          )}
          {isMidi && !compact && (
            <button
              type="button"
              onClick={() => setPianoRollOpen(p => !p)}
              className="text-[9px] uppercase tracking-widest border border-border text-muted-foreground hover:border-lime hover:text-lime px-1.5 py-0.5 transition"
            >
              {pianoRollOpen ? 'Close' : 'Edit'}
            </button>
          )}
          {!isMidi && !compact && track.file_size_bytes ? (
            <HoverTooltip label="Stored as FLAC. Download exports a larger WAV.">
              <span className="ml-auto text-[8px] font-mono text-muted-foreground tabular-nums pr-2 cursor-help">
                {fmtSize(track.file_size_bytes)}
              </span>
            </HoverTooltip>
          ) : null}
        </div>

        {/* Full-height chevron strip — right border of label column */}
        <button
          type="button"
          data-no-resource-filter
          onClick={(e) => {
            e.stopPropagation()
            if (showTools) {
              setShowTools(false)
              setConfirmDelete(false)
            } else {
              setShowTools(true)
            }
          }}
          className={`absolute right-0 top-0 bottom-0 w-5 flex items-center justify-center border-l transition-colors ${
            showTools
              ? 'border-lime/40 bg-surface text-lime'
              : 'border-border text-muted-foreground hover:bg-surface/60 hover:text-lime'
          }`}
          aria-label={showTools ? 'Close track actions' : 'Track actions'}
        >
          <svg
            width="6" height="10" viewBox="0 0 6 10"
            fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: showTools ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s ease' }}
            aria-hidden
          >
            <path d="M1 1.5L4.5 5 1 8.5" />
          </svg>
        </button>
      </div>

      {/* Track action drawer — overlays the waveform */}
      {showTools && (
        <>
          <div
            className="fixed inset-0 z-10"
            data-no-resource-filter
            onClick={() => { setShowTools(false); setConfirmDelete(false) }}
          />
          <div
            className="track-drawer absolute z-20 flex bg-background border-r border-border"
            style={{ left: labelColW, top: 0, bottom: 0, minHeight: rowH }}
            data-no-resource-filter
          >
            <TrackGainSlider
              value={trackGain}
              onChange={onTrackGainChange}
              disabled={midiRendering}
            />
            <button
              type="button"
              disabled={isReplacing || deleting}
              className="track-drawer-item flex flex-col items-center justify-center gap-2 w-20 border-r border-border/40 text-muted-foreground hover:bg-surface hover:text-lime transition-colors disabled:opacity-40 disabled:pointer-events-none"
              style={{ animationDelay: '40ms' }}
              onClick={() => { fileRef.current?.click(); setShowTools(false); setConfirmDelete(false) }}
              title={isReplacing ? 'Replacing…' : deleting ? 'Deleting…' : undefined}
            >
              <ReplaceIcon size={16} />
              <span className="text-[8px] uppercase tracking-[0.08em]">Replace</span>
            </button>
            <a
              href={`/api/tracks/${track.id}/download`}
              download
              className="track-drawer-item flex flex-col items-center justify-center gap-2 w-20 border-r border-border/40 text-muted-foreground hover:bg-surface hover:text-lime transition-colors no-underline"
              style={{ animationDelay: '80ms' }}
              onClick={() => { setShowTools(false); setConfirmDelete(false) }}
            >
              <DownloadIcon size={16} />
              <span className="text-[8px] uppercase tracking-[0.08em]">Download</span>
            </a>
            {confirmDelete ? (
              <div
                className="track-drawer-item flex flex-col items-center justify-center gap-1.5 w-20 px-1 transition-colors"
                style={{
                  animationDelay: '120ms',
                  background: deleteError ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.06)',
                }}
              >
                <span className="text-[8px] uppercase tracking-[0.08em] text-destructive font-bold">
                  {deleteError ? 'Failed' : 'Delete?'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-5 px-1.5 border border-border text-[8px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime transition"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                    className="h-5 px-1.5 border border-destructive bg-destructive text-white text-[8px] uppercase tracking-widest disabled:opacity-60 transition"
                  >
                    {deleting ? '…' : 'Yes'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={isReplacing || deleting}
                className="track-drawer-item flex flex-col items-center justify-center gap-2 w-20 text-muted-foreground hover:bg-surface hover:text-destructive transition-colors disabled:opacity-40 disabled:pointer-events-none"
                style={{ animationDelay: '160ms' }}
                onClick={() => setConfirmDelete(true)}
                title={isReplacing ? 'Replacing…' : undefined}
              >
                <TrashIcon size={16} />
                <span className="text-[8px] uppercase tracking-[0.08em]">Delete</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Waveform column */}
      <div
        ref={waveformColRef}
        data-waveform-col
        className="relative flex-1 min-w-0 overflow-hidden border-l border-border/0"
        style={{ minHeight: rowH, opacity: waveformOpacity, transition: 'opacity 0.15s' }}
      >
        {!commentMode && !editMode && (
          <TactGrid
            totalBars={totalBars}
            barDurationMs={barDurationMsRow}
            totalDurationMs={timelineDurationMs}
            interactive={waveformsInteractive}
            onTactClick={bar => { void snapStartBar(bar) }}
          />
        )}
      </div>

      {/* Edit mode — bar-snapped selection/segment editing replaces the normal clip */}
      {editMode && editArea}

      {/* Waveform clip — row-relative so pre-roll extends under the label column */}
      {!editMode && (
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
          cursor: !waveformsInteractive ? 'default' : isOffsetDragging ? 'grabbing' : commentMode ? 'inherit' : onSeek ? 'pointer' : 'grab',
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
                key={`${track.id}:${track.file_hash}`}
                trackId={track.id} color={accentColor}
                durationMs={trackOwnDurationMs} commentMode={commentMode}
                barCount={displayBarCount}
                comments={track.comments ?? []}
                activeInput={activeInput} audioReady={audioReady}
                onCommentPlace={onCommentPlace}
                onCommentDelete={onCommentDelete}
                onCommentCreate={onCommentCreate}
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
                projectOffsetMs={savedTrackOffsetMs}
              />
          )}
      </div>
      )}

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

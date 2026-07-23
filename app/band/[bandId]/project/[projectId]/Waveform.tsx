'use client'

// Track waveform renderer + drag-to-comment interaction — extracted verbatim from page.tsx.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { TrackComment } from '@/lib/types'
import { waveformBarsCache, fetchTrackAudioBuffer } from '@/lib/waveformCache'
import { WaveformBarsPlayhead, downsampleWaveformBars } from '@/components/WaveformBars'
import { CommentInputBubble, CommentRangeMarker } from './commentLayer'
import { fmtMs } from './mixerUtils'
import type { ActiveCommentInput } from './mixerTypes'

// ─── Waveform ─────────────────────────────────────────────────────────────────

export function Waveform({
  trackId, color, durationMs,
  commentMode, comments, activeInput, audioReady,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseInput, onReady,
  currentUserId, isOwner, onReplyCreate, currentUser,   onCommentInteractionChange,
  compact = false, barCount = 96, interactionsEnabled = true,
  projectOffsetMs = 0,
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
  /** Track start_bar offset — for project-timeline labels in tooltips. */
  projectOffsetMs?: number
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
        <WaveformBarsPlayhead
          bars={bars}
          color={color}
          ready={ready}
          animate={ready}
          className="h-full"
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
          commentMode={commentMode}
          onDelete={onCommentDelete}
          currentUserId={currentUserId}
          isOwner={isOwner}
          onReplyCreate={onReplyCreate}
          onInteractionChange={onCommentInteractionChange}
          projectOffsetMs={projectOffsetMs}
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

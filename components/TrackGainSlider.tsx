'use client'

import { useCallback, useRef } from 'react'

const MIN_GAIN = 0
const MAX_GAIN = 2
const DEFAULT_GAIN = 1
/** Same drag distance → 30% more gain change (relative to pointer-down origin). */
const GAIN_SENSITIVITY = 1.3

/** Thumb Y% from top: gain 0 = bottom, gain 1 = center, gain 2 = top. */
export function gainToThumbPct(gain: number): number {
  const clamped = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain))
  return (1 - clamped / MAX_GAIN) * 100
}

export function thumbPctToGain(pct: number): number {
  const y = Math.max(0, Math.min(100, pct)) / 100
  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, MAX_GAIN * (1 - y)))
}

function gainFromRelativeDrag(startGain: number, startY: number, y: number): number {
  return Math.max(
    MIN_GAIN,
    Math.min(MAX_GAIN, startGain + (startY - y) * MAX_GAIN * GAIN_SENSITIVITY),
  )
}

export function TrackGainSlider({
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  value: number
  onChange: (gain: number) => void
  disabled?: boolean
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const dragStartGainRef = useRef(DEFAULT_GAIN)
  const dragStartYRef = useRef(0.5)

  const thumbPct = gainToThumbPct(value)
  const centerPct = 50
  const fillTop = Math.min(centerPct, thumbPct)
  const fillHeight = Math.abs(thumbPct - centerPct)

  const clientYToY = useCallback((clientY: number): number | null => {
    const el = trackRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.height <= 0) return null
    return Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    const y = clientYToY(e.clientY)
    if (y === null) return

    draggingRef.current = true
    trackRef.current?.setPointerCapture(e.pointerId)

    // Snap gain to linear position under finger (full travel top/bottom).
    const jumped = thumbPctToGain(y * 100)
    dragStartYRef.current = y
    dragStartGainRef.current = jumped
    onChange(jumped)

    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return
      ev.preventDefault()
      const moveY = clientYToY(ev.clientY)
      if (moveY === null) return
      onChange(gainFromRelativeDrag(dragStartGainRef.current, dragStartYRef.current, moveY))
    }
    function onUp(ev: PointerEvent) {
      draggingRef.current = false
      trackRef.current?.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [disabled, clientYToY, onChange])

  return (
    <div
      className={`track-drawer-item flex items-center justify-center w-10 shrink-0 border-r border-border/40 ${className}`}
      style={{ animationDelay: '0ms' }}
      data-no-resource-filter
      onClick={e => e.stopPropagation()}
    >
      <div
        ref={trackRef}
        className={`relative flex items-center justify-center h-[min(100%,72px)] w-3 touch-none select-none ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-ns-resize'
        }`}
        role="slider"
        aria-label="Track gain"
        aria-valuemin={MIN_GAIN}
        aria-valuemax={MAX_GAIN}
        aria-valuenow={value}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
      >
        <div className="relative h-full w-px pointer-events-none">
          {/* Track rail */}
          <div className="absolute inset-0 bg-border/70" />
          {/* Accent fill from unity (center) to thumb */}
          {fillHeight > 0.5 && (
            <div
              className="absolute left-0 right-0 pointer-events-none bg-lime"
              style={{
                top: `${fillTop}%`,
                height: `${fillHeight}%`,
              }}
            />
          )}
          {/* Square thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 size-2 pointer-events-none bg-lime"
            style={{
              top: `calc(${thumbPct}% - 4px)`,
            }}
          />
          {/* Unity mark */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-1.5 h-px bg-muted-foreground/50 pointer-events-none"
            style={{ top: '50%' }}
          />
        </div>
      </div>
    </div>
  )
}

export { DEFAULT_GAIN as TRACK_DEFAULT_GAIN, MIN_GAIN as TRACK_MIN_GAIN, MAX_GAIN as TRACK_MAX_GAIN }

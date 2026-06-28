'use client'

import { useMemo, type CSSProperties } from 'react'

export const WAVEFORM_MIN_BAR_PCT = 15
export const WAVEFORM_BAR_GAP_CLASS = 'gap-[2px]'

export function waveformBarBackground(color: string, played: boolean): string {
  return played
    ? color
    : `color-mix(in oklab, ${color} 25%, transparent)`
}

export function downsampleWaveformBars(src: number[], count: number): number[] {
  if (src.length <= count) return src
  const out: number[] = []
  const step = src.length / count
  for (let i = 0; i < count; i++) {
    const s = Math.floor(i * step)
    const e = Math.min(src.length, Math.floor((i + 1) * step))
    let peak = 0
    for (let j = s; j < e; j++) peak = Math.max(peak, src[j])
    out.push(peak)
  }
  return out
}

/** Deterministic pseudo-random bars for placeholders and marketing previews. */
export function makeSeededWaveformBars(seed = 1, bars = 96, min = 0.15): number[] {
  let x = seed
  const rand = () => {
    x = (x * 9301 + 49297) % 233280
    return x / 233280
  }
  return Array.from({ length: bars }, (_, i) => {
    const envelope = Math.sin((i / bars) * Math.PI) * 0.6 + 0.4
    return Math.max(min, rand() * envelope)
  })
}

type WaveformBarRowProps = {
  bars: number[]
  color: string
  /** 0–1: bars left of this fraction use full color. Default 1 = all bright. */
  progress?: number
  className?: string
  barClassName?: string
  animate?: boolean
  animateDelayPerBarMs?: number
  minBarPct?: number
}

export function WaveformBarRow({
  bars,
  color,
  progress = 1,
  className = '',
  barClassName = '',
  animate = false,
  animateDelayPerBarMs = 4,
  minBarPct = WAVEFORM_MIN_BAR_PCT,
}: WaveformBarRowProps) {
  const n = bars.length
  return (
    <div className={`flex items-center ${WAVEFORM_BAR_GAP_CLASS} ${className}`}>
      {bars.map((h, i) => {
        const played = n > 0 ? i / n < progress : true
        return (
          <div
            key={i}
            className={`flex-1 min-w-0 rounded-full transition-colors${
              animate ? ' animate-draw-wave-h' : ''
            } ${barClassName}`}
            style={{
              height: `${Math.max(minBarPct, h * 100)}%`,
              background: waveformBarBackground(color, played),
              animationDelay: animate ? `${i * animateDelayPerBarMs}ms` : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

type WaveformBarsPlayheadProps = {
  bars: number[]
  color: string
  ready?: boolean
  className?: string
  animate?: boolean
  animKey?: number
  minBarPct?: number
}

/**
 * Dim base layer + bright overlay clipped by `--played-pct` on an ancestor.
 * Keeps bar DOM static during playback (no per-frame React updates).
 */
export function WaveformBarsPlayhead({
  bars,
  color,
  ready = true,
  className = '',
  animate = true,
  animKey = 0,
  minBarPct = WAVEFORM_MIN_BAR_PCT,
}: WaveformBarsPlayheadProps) {
  const dimColor = waveformBarBackground(color, false)
  const brightColor = waveformBarBackground(color, true)

  const dimBars = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={`${animKey}-d-${i}`}
          className={`flex-1 min-w-0 rounded-full${ready && animate ? ' animate-draw-wave-h' : ''}`}
          style={{
            height: `${Math.max(minBarPct, h * 100)}%`,
            background: dimColor,
            animationDelay: ready && animate ? `${i * 4}ms` : undefined,
          }}
        />
      )),
    [bars, ready, animate, animKey, minBarPct, dimColor],
  )

  const brightBars = useMemo(
    () =>
      bars.map((h, i) => (
        <div
          key={`${animKey}-b-${i}`}
          className={`flex-1 min-w-0 rounded-full${animate ? ' animate-draw-wave-h' : ''}`}
          style={{
            height: `${Math.max(minBarPct, h * 100)}%`,
            background: brightColor,
            animationDelay: animate ? `${i * 4}ms` : undefined,
          }}
        />
      )),
    [bars, animate, animKey, minBarPct, brightColor],
  )

  const rowClass = `flex items-center ${WAVEFORM_BAR_GAP_CLASS} ${className}`

  return (
    <>
      <div className={`absolute inset-0 ${rowClass}`}>{dimBars}</div>
      {ready && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ clipPath: 'inset(0 calc(100% - var(--played-pct, 0%)) 0 0)' }}
        >
          <div className={`absolute inset-0 ${rowClass}`}>{brightBars}</div>
        </div>
      )}
    </>
  )
}

type SeededWaveformProps = {
  seed?: number
  bars?: number
  color?: string
  progress?: number
  className?: string
  height?: number
}

/** Decorative waveform for landing / theme previews. */
export function SeededWaveform({
  seed = 1,
  bars = 96,
  color = 'var(--lime)',
  progress = 1,
  className = '',
  height = 64,
}: SeededWaveformProps) {
  const values = useMemo(() => makeSeededWaveformBars(seed, bars), [seed, bars])
  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <div className="absolute inset-0">
        <WaveformBarRow bars={values} color={color} progress={progress} className="h-full" />
      </div>
    </div>
  )
}

export function playedPctStyle(pct: number): CSSProperties {
  return { '--played-pct': `${pct}%` } as CSSProperties
}

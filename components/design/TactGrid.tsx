'use client'

export const BARS_PER_TACT = 4

/** Vertical tact columns aligned to the structure / bar ruler grid. */
export function TactGrid({
  totalBars,
  className,
  barsPerTact = BARS_PER_TACT,
  interactive = false,
  onTactClick,
  barDurationMs,
  totalDurationMs,
}: {
  totalBars: number
  className?: string
  barsPerTact?: number
  /** When true, tact columns accept clicks (e.g. to set track start bar). */
  interactive?: boolean
  onTactClick?: (startBar: number) => void
  /**
   * When both barDurationMs and totalDurationMs are provided, tact columns
   * are positioned using time-based math — matching the StructureEditor ruler
   * formula (bar * barDurationMs / totalDurationMs). Without these props,
   * the fallback is bar / totalBars, which drifts when totalDurationMs >
   * totalBars * barDurationMs (e.g. player.duration exceeds the bar grid).
   */
  barDurationMs?: number
  totalDurationMs?: number
}) {
  if (totalBars <= 0) return null
  const tactCount = Math.ceil(totalBars / barsPerTact)

  // Time-based positioning matches StructureEditor ruler; falls back to bar-count ratio.
  const toFraction = (bar: number): number =>
    barDurationMs && totalDurationMs && totalDurationMs > 0
      ? (bar * barDurationMs) / totalDurationMs
      : bar / totalBars

  return (
    <div
      className={[
        'absolute inset-0',
        interactive ? 'z-0' : 'pointer-events-none',
        className,
      ].filter(Boolean).join(' ')}
    >
      {Array.from({ length: tactCount }, (_, i) => {
        const bar = i * barsPerTact
        const span = Math.min(barsPerTact, totalBars - bar)
        const leftPct = toFraction(bar) * 100
        const widthPct = (toFraction(bar + span) - toFraction(bar)) * 100
        const heavy = (i + 1) % 4 === 0
        return (
          <button
            key={i}
            type="button"
            disabled={!interactive}
            aria-label={interactive ? `Set start to bar ${bar + 1}` : undefined}
            onClick={interactive && onTactClick
              ? e => {
                e.stopPropagation()
                onTactClick(bar)
              }
              : undefined}
            className={[
              'absolute top-0 bottom-0 border-r p-0',
              heavy ? 'border-border/30' : 'border-border/15',
              interactive
                ? 'cursor-pointer hover:bg-ember/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ember/40'
                : '',
            ].join(' ')}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        )
      })}
    </div>
  )
}

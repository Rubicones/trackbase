'use client'

export const BARS_PER_TACT = 4

/** Vertical tact columns aligned to the structure / bar ruler grid. */
export function TactGrid({
  totalBars,
  className,
  barsPerTact = BARS_PER_TACT,
}: {
  totalBars: number
  className?: string
  barsPerTact?: number
}) {
  if (totalBars <= 0) return null
  const tactCount = Math.ceil(totalBars / barsPerTact)

  return (
    <div className={`absolute inset-0 pointer-events-none ${className ?? ''}`}>
      {Array.from({ length: tactCount }, (_, i) => {
        const bar = i * barsPerTact
        const span = Math.min(barsPerTact, totalBars - bar)
        const leftPct = (bar / totalBars) * 100
        const widthPct = (span / totalBars) * 100
        return (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-r border-border/30"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        )
      })}
    </div>
  )
}

'use client'

type TrackLoadProgressBarProps = {
  loaded?: number
  total?: number
  label?: string
  /** When true, show a sliding bar instead of a determinate percentage. */
  indeterminate?: boolean
  className?: string
}

export function TrackLoadProgressBar({
  loaded = 0,
  total = 0,
  label,
  indeterminate = false,
  className,
}: TrackLoadProgressBarProps) {
  const pct = !indeterminate && total > 0
    ? Math.round((loaded / total) * 100)
    : undefined

  return (
    <div className={['w-full', className].filter(Boolean).join(' ')}>
      {(label || pct !== undefined) && (
        <div className="flex items-center justify-between gap-3 mb-1.5">
          {label ? (
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground truncate">
              {label}
            </span>
          ) : <span />}
          {pct !== undefined && (
            <span className="text-[9px] font-mono tabular-nums text-muted-foreground shrink-0">
              {loaded}/{total}
            </span>
          )}
        </div>
      )}
      <div
        className="h-1 bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={indeterminate ? undefined : total || 100}
        aria-valuenow={indeterminate ? undefined : loaded}
        aria-label={label ?? 'Loading tracks'}
      >
        {indeterminate ? (
          <div className="h-full w-1/3 bg-ember animate-track-load-indeterminate" />
        ) : (
          <div
            className="h-full bg-ember transition-[width] duration-300"
            style={{ width: `${pct ?? 0}%` }}
          />
        )}
      </div>
    </div>
  )
}

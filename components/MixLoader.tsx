'use client'

import { SpinnerBars } from '@/components/ui/Spinner'
import { TrackLoadProgressBar } from '@/components/TrackLoadProgressBar'

type MixLoaderProps = {
  label?: string
  fullscreen?: boolean
  /** 0–100. When set, shows a real determinate bar. Otherwise indeterminate. */
  progress?: number
  className?: string
}

export function MixLoader({
  label = 'Loading',
  fullscreen = true,
  progress: controlledProgress,
  className,
}: MixLoaderProps) {
  const indeterminate = controlledProgress === undefined

  return (
    <div
      className={[
        fullscreen ? 'page-loading-overlay' : 'page-loading-inline',
        className,
      ].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label={indeterminate ? label : `${label} ${controlledProgress}%`}
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4 px-6">
        <div className="flex items-center gap-3">
          <SpinnerBars />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {label}
            {!indeterminate ? ` · ${controlledProgress}%` : ''}
          </span>
        </div>
        {indeterminate ? (
          <TrackLoadProgressBar indeterminate className="w-full" />
        ) : (
          <div className="h-1 w-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-ember transition-[width] duration-300"
              style={{ width: `${controlledProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

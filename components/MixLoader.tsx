'use client'

import { useEffect, useState } from 'react'
import { SpinnerBars } from '@/components/ui/Spinner'

type MixLoaderProps = {
  label?: string
  fullscreen?: boolean
  /** 0–100. Omit to animate simulated progress while loading. */
  progress?: number
  className?: string
}

export function MixLoader({
  label = 'Loading',
  fullscreen = true,
  progress: controlledProgress,
  className,
}: MixLoaderProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (controlledProgress !== undefined) return
    setProgress(0)
    const id = window.setInterval(() => {
      setProgress(p => (p >= 92 ? p : Math.min(92, p + 4 + Math.random() * 6)))
    }, 320)
    return () => window.clearInterval(id)
  }, [controlledProgress])

  const pct = controlledProgress ?? Math.round(progress)

  return (
    <div
      className={[
        fullscreen ? 'page-loading-overlay' : 'page-loading-inline',
        className,
      ].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-label={`${label} ${pct}%`}
    >
      <div className="flex items-center gap-3">
        <SpinnerBars />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label} · {pct}%
        </span>
      </div>
    </div>
  )
}

'use client'

import { usePathname } from 'next/navigation'
import { MixLoader } from '@/components/MixLoader'
import { SpinnerBars } from '@/components/ui/Spinner'
import { getLoadingLabel } from '@/lib/loadingLabels'

export function BrandSpinner({
  fullscreen = true,
  label,
}: {
  fullscreen?: boolean
  label?: string
}) {
  const pathname = usePathname()
  const resolvedLabel = label ?? getLoadingLabel(pathname)

  if (fullscreen) {
    return <MixLoader label={resolvedLabel} fullscreen />
  }

  return (
    <div
      className="page-loading-inline"
      role="status"
      aria-live="polite"
      aria-label={resolvedLabel}
    >
      <div className="flex items-center gap-3">
        <SpinnerBars />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {resolvedLabel}
        </span>
      </div>
    </div>
  )
}

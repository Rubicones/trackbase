'use client'

import { Spinner } from '@/components/ui/Spinner'

export function BrandSpinner({
  fullscreen = true,
  label = 'Loading',
}: {
  fullscreen?: boolean
  label?: string
}) {
  return (
    <div
      className={fullscreen ? 'page-loading-overlay' : 'page-loading-inline'}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <Spinner size={40} label={fullscreen ? undefined : label} />
    </div>
  )
}

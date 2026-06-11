'use client'

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
      <div className="brand-spinner">
        <svg className="brand-spinner-svg" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
          <circle className="brand-spinner-track" cx="22" cy="22" r="17" />
          <circle className="brand-spinner-arc" cx="22" cy="22" r="17" />
        </svg>
      </div>
    </div>
  )
}

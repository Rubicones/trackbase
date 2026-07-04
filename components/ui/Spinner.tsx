'use client'

type SpinnerProps = {
  size?: number
  className?: string
  label?: string
  tone?: 'lime' | 'foreground' | 'muted' | 'white' | 'amber'
}

/** Brutalist 8-tick rotor — matches sonicdesk-uikit spinner. */
export function Spinner({ size = 20, className, label, tone = 'lime' }: SpinnerProps) {
  const color =
    tone === 'lime' ? 'var(--lime)'
      : tone === 'muted' ? 'var(--muted-foreground)'
      : tone === 'white' ? '#fff'
      : tone === 'amber' ? 'var(--amber)'
      : 'var(--foreground)'
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={['inline-flex items-center gap-2 align-middle', className].filter(Boolean).join(' ')}
    >
      <span
        className="relative inline-block animate-spin-tb"
        style={{ width: size, height: size }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 block"
            style={{
              width: Math.max(2, Math.round(size * 0.12)),
              height: Math.max(3, Math.round(size * 0.22)),
              marginLeft: -Math.max(1, Math.round(size * 0.06)),
              marginTop: -Math.max(2, Math.round(size * 0.11)),
              background: color,
              opacity: 0.15 + (i / 8) * 0.85,
              transform: `rotate(${i * 45}deg) translateY(-${size * 0.36}px)`,
              transformOrigin: 'center',
            }}
          />
        ))}
      </span>
      {label ? (
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </span>
  )
}

export function SpinnerBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid place-items-center gap-3 p-8">
      <Spinner size={32} />
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  )
}

export function SpinnerBars({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={['inline-flex items-end gap-[2px] h-4', className].filter(Boolean).join(' ')}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] bg-lime animate-bars-pulse"
          style={{ animationDelay: `${i * 110}ms` }}
        />
      ))}
    </span>
  )
}

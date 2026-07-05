'use client'

import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { SonicdeskWordmark } from '@/components/design/SonicdeskWordmark'

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background grid-bg-sm">
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background/85 px-6 backdrop-blur-md shrink-0">
        <SonicdeskWordmark />
        <span className="hidden sm:inline text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Git-like versioning for music demos
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6 md:py-12">
        {children}
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur px-6 py-2 flex items-center justify-between text-[10px] text-muted-foreground shrink-0">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-online animate-pulse-dot" />
          <span className="uppercase tracking-widest">SYS OK</span>
        </div>
        <span className="hidden sm:inline text-foreground font-bold tracking-widest">
          sonicdesk // v0.9
        </span>
      </footer>
    </div>
  )
}

export function AuthCard({
  children,
  className = '',
  wide = false,
}: {
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <div
      className={[
        'w-full border border-border bg-surface animate-slide-in',
        wide ? 'max-w-lg' : 'max-w-md',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}

export function AuthCardHeader({
  title,
  subtitle,
  tag,
}: {
  title: string
  subtitle?: string
  tag?: string
}) {
  return (
    <div className="border-b border-border px-6 py-5">
      {tag && (
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground mb-2">
          {tag}
        </div>
      )}
      <h1 className="font-display text-xl uppercase tracking-tight text-foreground m-0">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1.5 mb-0 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>
      )}
    </div>
  )
}

export function AuthCardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>
}

export function AuthWaveAccent() {
  const heights = [0.35, 0.55, 0.8, 1, 0.7, 0.45, 0.6, 0.9, 0.5, 0.75, 0.4, 0.65]
  return (
    <div
      className="flex items-end gap-[2px] h-6 px-6 pt-4"
      aria-hidden
    >
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[3px] bg-lime/70 animate-draw-wave"
          style={{
            height: `${Math.round(h * 100)}%`,
            animationDelay: `${i * 40}ms`,
          }}
        />
      ))}
    </div>
  )
}

export function AuthLoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-4">
        <Spinner size={32} />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
    </AuthShell>
  )
}

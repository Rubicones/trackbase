'use client'

import Link from 'next/link'
import { useState, useEffect, type ReactNode } from 'react'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { PushBellButton } from '@/components/push/PushBellButton'

function TrackbaseLogo() {
  const [launched, setLaunched] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLaunched(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <Link
      href="/dashboard"
      className="group flex items-center gap-2.5 no-underline shrink-0"
    >
      <div className="w-4 h-8 flex items-center justify-center shrink-0">
        <div
          className={`w-4 rounded-full bg-lime transition-all ease-out ${
            launched ? 'h-2 group-hover:h-8 duration-200' : 'h-8 duration-700'
          }`}
        />
      </div>
      <span className="font-display text-lg md:text-xl lg:text-2xl font-bold tracking-tight text-lime">
        TRACKBASE
      </span>
    </Link>
  )
}

export function AppHeader({ crumbs, right, left }: { crumbs?: ReactNode; right?: ReactNode; left?: ReactNode }) {
  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background/85 px-6 backdrop-blur-md">
      <div className="flex items-center gap-4 min-w-0">
        {left}
        <TrackbaseLogo />
        <div className="hidden md:flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground min-w-0">
          <Link href="/dashboard" className="hover:text-foreground transition-colors no-underline text-muted-foreground">
            Bands
          </Link>
          {crumbs && (
            <>
              <span className="text-border">/</span>
              {crumbs}
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {right}
        <PushBellButton />
        <AvatarDropdown />
      </div>
    </nav>
  )
}

export function StatusFooter({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <footer className="sticky bottom-0 left-0 right-0 h-[var(--shell-footer-h)] border-t border-border bg-background/95 backdrop-blur px-6 flex items-center justify-between text-[10px] text-muted-foreground z-40">
      <div className="flex gap-6 items-center min-w-0">
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <span className="size-1.5 rounded-full bg-online animate-pulse-dot" />
          <span className="uppercase tracking-widest">SYS OK</span>
        </div>
        {left}
      </div>
      <div className="flex gap-6 items-center shrink-0">
        {right}
        <Link
          href="/uikit"
          className="hidden sm:inline-block text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime no-underline"
          title="UI Kit & Brandbook"
        >
          UI Kit
        </Link>
        <span className="text-foreground font-bold tracking-widest hidden sm:inline">TRACKBASE // v0.9</span>
      </div>
    </footer>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
      {children}
    </div>
  )
}

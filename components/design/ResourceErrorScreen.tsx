'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { AppHeader, StatusFooter } from '@/components/design/AppShell'

type ErrorAction = {
  label: string
  href?: string
  onClick?: () => void
  primary?: boolean
}

export function ResourceErrorScreen({
  crumbs,
  title,
  description,
  accessDenied = false,
  actions,
}: {
  crumbs?: ReactNode
  title: string
  description: string
  accessDenied?: boolean
  actions: ErrorAction[]
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <AppHeader crumbs={crumbs} />
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm border border-border bg-surface p-8 flex flex-col items-center text-center gap-4">
          <div className="size-12 border border-border grid place-items-center text-muted-foreground">
            {accessDenied ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <rect x="5" y="9" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M10 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                <circle cx="10" cy="13" r="0.8" fill="currentColor" />
              </svg>
            )}
          </div>
          <div>
            <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">
              {title}
            </p>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed m-0">
              {description}
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full mt-2">
            {actions.map(action => {
              const className = `w-full justify-center text-[10px] uppercase tracking-widest transition disabled:opacity-50 ${
                action.primary
                  ? 'bg-lime text-primary-foreground border border-lime px-3 py-2 font-display font-bold'
                  : 'border border-border text-muted-foreground hover:border-lime hover:text-lime px-3 py-2'
              }`
              if (action.href) {
                return (
                  <Link key={action.label} href={action.href} className={`${className} no-underline inline-flex items-center`}>
                    {action.label}
                  </Link>
                )
              }
              return (
                <button key={action.label} type="button" onClick={action.onClick} className={className}>
                  {action.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <StatusFooter />
    </div>
  )
}

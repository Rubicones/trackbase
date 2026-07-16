'use client'

import type { ReactNode } from 'react'

/**
 * Shared visual treatment for a locked (test-paywall) button.
 * Dimmed and hover-less, but NOT DOM-disabled — the click must still land
 * so it can open the plans modal.
 */
export const paywallLockedButtonClass = 'opacity-50 cursor-default'

/** Small accent square with a plus sign, overlapping the button's top-right corner. */
export function PlusBadge() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-[5px] -right-[5px] z-10 grid size-[11px] place-items-center bg-lime text-primary-foreground"
    >
      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
        <path d="M4 1v6M1 4h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

/**
 * Wraps a locked button so the plus badge can sit on its corner without
 * inheriting the button's reduced opacity.
 */
export function PaywallLockWrap({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`relative inline-flex ${className}`}>
      {children}
      <PlusBadge />
    </span>
  )
}

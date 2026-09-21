'use client'

import type { ReactNode } from 'react'
import { Plus } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'

/**
 * The locked-control treatment, from the subscription design kit
 * ("Access & locks").
 *
 * Two rules, both easy to break by accident:
 *
 *   1. **Dimmed, never DOM-disabled.** A `disabled` button swallows the click,
 *      and the click is the whole point — it is what opens the plans modal and
 *      what records the demand signal. A locked control that does nothing when
 *      pressed reads as a bug, and measures as silence.
 *   2. **The badge must not inherit the dimming.** It sits outside the button,
 *      in a wrapper, so the marker stays legible on a control at 50% opacity.
 *
 * The call sites keep their own button markup — the lock is a button in a
 * toolbar here, an icon square in a track row there — so this module ships the
 * shared class and the badge rather than a button component that each caller
 * would have to fight.
 */
export const paywallLockedButtonClass = 'opacity-50 cursor-default'

/** Accent square with a plus, overlapping the control's top-right corner. */
export function PlusBadge() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-[5px] -top-[5px] z-10 grid size-[11px] place-items-center bg-lime text-primary-foreground"
    >
      <LucideIcon icon={Plus} size={7} strokeWidth={3} />
    </span>
  )
}

/**
 * Wraps a locked control so the plus badge can sit on its corner without
 * inheriting the control's reduced opacity.
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

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

/**
 * The PENDING treatment, for a gated control whose plan has not answered yet.
 *
 * Deliberately not the locked treatment. A lock is a claim — "you do not have
 * this" — and at this point we do not know that. Flashing one over a feature a
 * paying user owns, on every page load, is exactly the failure this state
 * exists to avoid. So: dimmed, no badge, no hover affordance, progress cursor.
 *
 * ⚠ The rule that matters is not in this class. A pending control must be
 * rendered as its OWN element carrying no `onClick` — never the real control
 * with `disabled` added. `disabled` is an attribute and an attribute can be
 * deleted from the markup in a second; a handler React never attached cannot
 * be restored at all. `pointer-events-none` below is comfort, not enforcement.
 * See `usePaywallGate` in `contexts/PaywallContext.tsx`.
 */
export const paywallPendingButtonClass =
  'opacity-40 cursor-progress pointer-events-none select-none'

/**
 * The attributes every pending control repeats, in one place so no call site
 * forgets one. Spread onto the inert element.
 *
 * `tabIndex: -1` matters as much as the styling: without it the control stays
 * in the tab order and a keyboard user can activate markup that is meant to be
 * unusable. `guard()` would refuse the action anyway — this stops it looking
 * like a control that silently does nothing.
 */
export const paywallPendingProps = {
  'aria-disabled': true,
  'aria-busy': true,
  tabIndex: -1,
  title: 'Checking your plan…',
} as const

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

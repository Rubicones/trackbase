'use client'

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type FloatingPopoverProps = {
  left: number
  top: number
  width?: number
  transform?: string
  className?: string
  onMouseLeave?: () => void
  children: ReactNode
}

/** Portal popover aligned to design tokens (border-border, bg-popover). */
export function FloatingPopover({
  left,
  top,
  width,
  transform = 'translateY(-100%)',
  className,
  onMouseLeave,
  children,
}: FloatingPopoverProps) {
  return createPortal(
    <div
      className={[
        'fixed z-[6000] border border-border bg-popover shadow-2xl animate-slide-in pointer-events-auto',
        className,
      ].filter(Boolean).join(' ')}
      style={{ left, top, width, transform }}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>,
    document.body,
  )
}

'use client'

import { type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type FloatingPopoverProps = {
  left: number
  top: number
  width?: number
  transform?: string
  className?: string
  onMouseLeave?: () => void
  onMouseEnter?: () => void
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
  onMouseEnter,
  children,
}: FloatingPopoverProps) {
  function stopBubble(e: MouseEvent | PointerEvent) {
    e.stopPropagation()
  }

  return createPortal(
    <div
      className={[
        'fixed z-[6000] border border-border bg-popover shadow-2xl animate-slide-in pointer-events-auto',
        className,
      ].filter(Boolean).join(' ')}
      style={{ left, top, width, transform }}
      data-comment-ui
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
      onMouseDown={stopBubble}
      onPointerDown={stopBubble}
      onClick={stopBubble}
    >
      {children}
    </div>,
    document.body,
  )
}

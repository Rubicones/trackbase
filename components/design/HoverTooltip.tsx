'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Width of a `multiline` tooltip — also what the edge clamp assumes. */
const MULTILINE_MAX_WIDTH = 288
const EDGE_GAP = 8

/**
 * Inverted uikit tooltip — bg-foreground / text-background. Portals to body to
 * avoid overflow clipping.
 *
 * Use this instead of a native `title`: the browser's tooltip ignores the
 * theme, waits a second before appearing, and cannot be styled.
 *
 * `multiline` is for a sentence (a limit explanation, say) rather than a
 * label: it wraps at a fixed width, and is kept inside the viewport. Shown on
 * hover and on keyboard focus. With no `label` it renders only the children,
 * so a call site can pass a conditional string straight through.
 */
export function HoverTooltip({
  label,
  children,
  className,
  placement = 'top',
  multiline = false,
}: {
  label: string | null | undefined
  children: ReactNode
  className?: string
  placement?: 'top' | 'bottom'
  multiline?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()

  function updatePosition() {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = rect.left + rect.width / 2
    if (multiline && typeof window !== 'undefined') {
      const half = MULTILINE_MAX_WIDTH / 2
      left = Math.min(Math.max(left, half + EDGE_GAP), window.innerWidth - half - EDGE_GAP)
    }
    setCoords({ top: placement === 'bottom' ? rect.bottom + 8 : rect.top - 8, left })
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, multiline])

  const shape = multiline
    ? 'w-max max-w-72 whitespace-normal text-left leading-5 px-3 py-2'
    : 'whitespace-nowrap px-3 py-1.5'
  const tooltipClass = `fixed z-[9999] -translate-x-1/2 ${
    placement === 'bottom' ? '' : '-translate-y-full'
  } ${shape} text-xs bg-foreground text-background pointer-events-none shadow-sm`

  const show = () => {
    if (!label) return
    setOpen(true)
    updatePosition()
  }

  return (
    <div
      ref={anchorRef}
      className={className ?? ''}
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={() => setOpen(false)}
      aria-describedby={open && label ? tooltipId : undefined}
    >
      {children}
      {open && label && typeof document !== 'undefined' && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className={tooltipClass}
          style={{ top: coords.top, left: coords.left }}
        >
          {label}
        </div>,
        document.body,
      )}
    </div>
  )
}

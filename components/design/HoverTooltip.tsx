'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Inverted uikit tooltip — bg-foreground / text-background. Portals to body to avoid overflow clipping. */
export function HoverTooltip({
  label,
  children,
  className,
  placement = 'top',
}: {
  label: string
  children: ReactNode
  className?: string
  placement?: 'top' | 'bottom'
}) {
  const [hovered, setHovered] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)

  function updatePosition() {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setCoords({
      top: placement === 'bottom' ? rect.bottom + 8 : rect.top - 8,
      left: rect.left + rect.width / 2,
    })
  }

  useEffect(() => {
    if (!hovered) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [hovered, placement])

  const tooltipClass =
    placement === 'bottom'
      ? 'fixed z-[9999] -translate-x-1/2 px-3 py-1.5 text-xs bg-foreground text-background whitespace-nowrap pointer-events-none shadow-sm'
      : 'fixed z-[9999] -translate-x-1/2 -translate-y-full px-3 py-1.5 text-xs bg-foreground text-background whitespace-nowrap pointer-events-none shadow-sm'

  return (
    <div
      ref={anchorRef}
      className={className ?? ''}
      onMouseEnter={() => {
        setHovered(true)
        updatePosition()
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && typeof document !== 'undefined' && createPortal(
        <div
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

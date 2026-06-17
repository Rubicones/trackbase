'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Inverted uikit tooltip — bg-foreground / text-background. Portals to body to avoid overflow clipping. */
export function HoverTooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const [hovered, setHovered] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<HTMLDivElement>(null)

  function updatePosition() {
    const el = anchorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setCoords({
      top: rect.top - 8,
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
  }, [hovered])

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
          className="fixed z-[9999] -translate-x-1/2 -translate-y-full px-3 py-1.5 text-xs bg-foreground text-background whitespace-nowrap pointer-events-none shadow-sm"
          style={{ top: coords.top, left: coords.left }}
        >
          {label}
        </div>,
        document.body,
      )}
    </div>
  )
}

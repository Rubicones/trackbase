'use client'

import { useState, type ReactNode } from 'react'

/** Inverted uikit tooltip — bg-foreground / text-background. */
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
  return (
    <div
      className={`relative ${className ?? ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 px-3 py-1.5 text-xs bg-foreground text-background whitespace-nowrap pointer-events-none"
        >
          {label}
        </div>
      )}
    </div>
  )
}

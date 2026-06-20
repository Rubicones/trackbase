import type { JSX } from 'react'
import type { IconNode } from 'lucide'

const SVG_ATTRS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function LucideIcon({
  icon,
  size = 16,
  strokeWidth = 1.75,
  className,
}: {
  icon: IconNode
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      {...SVG_ATTRS}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden
    >
      {icon.map(([tag, attrs], i) => {
        const Tag = tag as keyof JSX.IntrinsicElements
        return <Tag key={i} {...attrs} />
      })}
    </svg>
  )
}

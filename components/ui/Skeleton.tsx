'use client'

import type { CSSProperties } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  className?: string
  style?: CSSProperties
}

/**
 * Single skeleton block with shimmer animation.
 * Uses CSS variables so it adapts to light/dark themes automatically.
 */
export function Skeleton({ width, height, borderRadius, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={['skeleton-shimmer block', className].filter(Boolean).join(' ')}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius,
        ...style,
      }}
    />
  )
}

'use client'

import type { CSSProperties, ReactNode } from 'react'
import { avatarCssVars, avatarInitials } from '@/lib/avatarTheme'
import { usePalette } from '@/contexts/PaletteContext'

export function ThemeAvatar({
  seed,
  size,
  shape = 'rounded',
  radius,
  fontSize,
  className,
  kind = 'band',
  children,
  title,
}: {
  seed: string
  size: number
  shape?: 'circle' | 'rounded'
  /** Override corner radius (px) when shape is rounded */
  radius?: number
  fontSize?: number
  className?: string
  kind?: 'band' | 'user'
  children?: ReactNode
  title?: string
}) {
  const { palette } = usePalette()
  const borderRadius =
    radius != null ? radius : shape === 'circle' ? '50%' : Math.round(size * 0.23)

  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius,
    fontSize: fontSize ?? Math.round(size * (shape === 'circle' ? 0.34 : 0.36)),
    ...avatarCssVars(seed, palette),
  }

  return (
    <div
      className={['theme-avatar', className].filter(Boolean).join(' ')}
      style={style}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {children ?? avatarInitials(seed, kind)}
    </div>
  )
}

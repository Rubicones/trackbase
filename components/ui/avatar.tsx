import type { CSSProperties, ReactNode } from 'react'
import { avatarColor, avatarInitials } from '@/lib/avatarTheme'

export function Avatar({ children, className = '', style }: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`relative flex shrink-0 overflow-hidden ${className}`}
      style={style}
    >
      {children}
    </span>
  )
}

export function AvatarFallback({ children, className = '', style }: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`flex h-full w-full items-center justify-center ${className}`}
      style={style}
    >
      {children}
    </span>
  )
}

/** Square uikit avatar — display initials on band/user color. */
export function UserAvatar({
  seed,
  size = 40,
  kind = 'user',
  className = '',
}: {
  seed: string
  size?: number
  kind?: 'band' | 'user'
  className?: string
}) {
  const color = avatarColor(seed)
  const initials = avatarInitials(seed, kind)

  return (
    <Avatar
      className={`rounded-none border border-border ${className}`}
      style={{ width: size, height: size }}
    >
      <AvatarFallback
        className="rounded-none font-display font-bold text-background"
        style={{ backgroundColor: color, fontSize: Math.round(size * 0.32) }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

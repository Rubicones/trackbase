'use client'

// Deterministic avatar: hashes the username into one of 8 palette colors.

const PALETTE = [
  { bg: 'rgba(99,102,241,0.18)',  text: '#818cf8' }, // indigo
  { bg: 'rgba(52,211,153,0.18)',  text: '#34d399' }, // emerald
  { bg: 'rgba(251,191,36,0.18)',  text: '#fbbf24' }, // amber
  { bg: 'rgba(248,113,113,0.18)', text: '#f87171' }, // red
  { bg: 'rgba(96,165,250,0.18)',  text: '#60a5fa' }, // blue
  { bg: 'rgba(232,121,249,0.18)', text: '#e879f9' }, // fuchsia
  { bg: 'rgba(45,212,191,0.18)',  text: '#2dd4bf' }, // teal
  { bg: 'rgba(251,146,60,0.18)',  text: '#fb923c' }, // orange
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

interface AvatarProps {
  username: string
  size?: number
  className?: string
}

export function Avatar({ username, size = 32, className }: AvatarProps) {
  const color = PALETTE[hashString(username) % PALETTE.length]
  const initials = username.slice(0, 2).toUpperCase()
  const fontSize = Math.round(size * 0.34)

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        color: color.text,
        letterSpacing: '-0.01em',
        flexShrink: 0,
        userSelect: 'none',
      }}
      title={`@${username}`}
    >
      {initials}
    </div>
  )
}

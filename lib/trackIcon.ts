/** Default track icon background — light purple from the icon picker palette. */
export const DEFAULT_TRACK_ICON_COLOR = 'rgba(167,139,250,0.15)'

/** Legacy DB default before light purple was introduced. */
export const LEGACY_TRACK_ICON_COLOR = '#0d0d1f'

/** Stored icon picker swatches (light-mode canonical values). */
export const TRACK_ICON_COLORS = [
  'rgba(52,211,153,0.15)',
  'rgba(251,191,36,0.15)',
  DEFAULT_TRACK_ICON_COLOR,
  'rgba(232,121,249,0.15)',
  'rgba(96,165,250,0.15)',
  'rgba(248,113,113,0.15)',
  'rgba(255,255,255,0.10)',
  'rgba(52,211,153,0.25)',
]

function boostRgbaForDark(color: string): string {
  const match = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/)
  if (!match) return color

  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1
  const boosted = Math.min(0.55, Math.max(0.32, alpha * 2.4))

  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${boosted})`
}

/** Resolve stored icon color; optionally boost opacity for dark backgrounds. */
export function resolveTrackIconColor(
  color: string | null | undefined,
  isDark = false
): string {
  const resolved =
    !color || color === LEGACY_TRACK_ICON_COLOR ? DEFAULT_TRACK_ICON_COLOR : color

  return isDark ? boostRgbaForDark(resolved) : resolved
}

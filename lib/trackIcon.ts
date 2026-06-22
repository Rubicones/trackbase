/** Vivid swatches for track badge + waveform accent. */
export const TRACK_ICON_SWATCHES = [
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#60a5fa',
  '#e879f9',
  '#f472b6',
  '#2dd4bf',
  '#fb923c',
  '#a3e635',
] as const

const LEGACY_TRACK_ICON_COLOR = '#0d0d1f'
/** Washed-out default from an older migration — not a vivid swatch. */
const LEGACY_SOFT_ICON_COLOR = 'rgba(167,139,250,0.15)'

export function randomTrackIconColor(): string {
  return TRACK_ICON_SWATCHES[Math.floor(Math.random() * TRACK_ICON_SWATCHES.length)]
}

/** Swatch colors already assigned on sibling tracks. */
export function usedTrackIconSwatches(colors: (string | null | undefined)[]): Set<string> {
  const used = new Set<string>()
  for (const c of colors) {
    if (c && !needsTrackIconColor(c)) used.add(c)
  }
  return used
}

/**
 * Default color for a new track — prefers swatches not yet used on siblings;
 * rotates by trackIndex when the palette is exhausted.
 */
export function pickTrackIconColor(
  siblingColors: (string | null | undefined)[],
  trackIndex = 0,
): string {
  const used = usedTrackIconSwatches(siblingColors)
  const unused = TRACK_ICON_SWATCHES.filter(s => !used.has(s))
  if (unused.length > 0) {
    return unused[trackIndex % unused.length]
  }
  return defaultTrackIconColorForIndex(trackIndex)
}

export function defaultTrackIconColorForIndex(index: number): string {
  return TRACK_ICON_SWATCHES[index % TRACK_ICON_SWATCHES.length]
}

/** True when the track should be assigned a new palette color. */
export function needsTrackIconColor(color: string | null | undefined): boolean {
  if (!color) return true
  if (color === LEGACY_TRACK_ICON_COLOR || color === LEGACY_SOFT_ICON_COLOR) return true
  return !(TRACK_ICON_SWATCHES as readonly string[]).includes(color)
}

export function resolveTrackIconColor(color: string | null | undefined): string {
  if (needsTrackIconColor(color)) {
    return TRACK_ICON_SWATCHES[0]
  }
  return color!
}

/** Badge / waveform accent — stored color or stable palette fallback by index. */
export function trackAccentColor(
  iconColor: string | null | undefined,
  fallbackIndex: number,
): string {
  if (!needsTrackIconColor(iconColor)) return iconColor!
  return defaultTrackIconColorForIndex(fallbackIndex)
}

export function getTrackIconSwatches(): readonly string[] {
  return TRACK_ICON_SWATCHES
}

/** Color palette themes — paired with light/dark mode via next-themes. */

export type PaletteId =
  | 'default'
  | 'default-mono-tracks'
  | 'mono'
  | 'blue'
  | 'sepia'
  | 'green'

export type PaletteMeta = {
  id: PaletteId
  label: string
  /** Preview swatch for the picker */
  swatch: string
  swatchAlt?: string
}

export const PALETTE_OPTIONS: PaletteMeta[] = [
  { id: 'default', label: 'Default', swatch: '#6366F1', swatchAlt: '#818cf8' },
  {
    id: 'default-mono-tracks',
    label: 'Default · mono tracks',
    swatch: '#6366F1',
    swatchAlt: '#888888',
  },
  { id: 'mono', label: 'Monochrome', swatch: '#888888', swatchAlt: '#CCCCCC' },
  { id: 'blue', label: 'Blue', swatch: '#7BAFD4', swatchAlt: '#A8CCE8' },
  { id: 'sepia', label: 'Sepia', swatch: '#C49A6C', swatchAlt: '#E0C4A8' },
  { id: 'green', label: 'Green', swatch: '#8FB996', swatchAlt: '#B5D4BC' },
]

export const PALETTE_STORAGE_KEY = 'trackbase-palette'

export function isPaletteId(value: string | null | undefined): value is PaletteId {
  return PALETTE_OPTIONS.some(p => p.id === value)
}

export function normalizePaletteId(value: string | null | undefined): PaletteId {
  return isPaletteId(value) ? value : 'default'
}

/** Palettes that greyscale mixer waveforms only (UI stays default). */
export function usesMonoTracks(id: PaletteId): boolean {
  return id === 'mono' || id === 'default-mono-tracks'
}

/** Read palette from DOM — safe for modules called during render on client. */
export function getActivePalette(): PaletteId {
  if (typeof document === 'undefined') return 'default'
  return normalizePaletteId(document.documentElement.getAttribute('data-palette'))
}

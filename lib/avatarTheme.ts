/** Deterministic avatar palette — shared across band cards, headers, members. */

import type { PaletteId } from '@/lib/palettes'
import { getActivePalette } from '@/lib/palettes'

export type AvatarPalette = {
  main: string
  light: string
  dark: string
}

export const AVATAR_PALETTES: AvatarPalette[] = [
  { main: '#6366F1', light: '#818cf8', dark: '#4f46e5' },
  { main: '#10B981', light: '#34d399', dark: '#059669' },
  { main: '#F59E0B', light: '#fbbf24', dark: '#d97706' },
  { main: '#EC4899', light: '#f472b6', dark: '#db2777' },
  { main: '#06B6D4', light: '#22d3ee', dark: '#0891b2' },
  { main: '#8B5CF6', light: '#a78bfa', dark: '#7c3aed' },
  { main: '#F97316', light: '#fb923c', dark: '#ea580c' },
  { main: '#14B8A6', light: '#2dd4bf', dark: '#0d9488' },
]

const MONO_PALETTES: AvatarPalette[] = [
  { main: '#737373', light: '#A3A3A3', dark: '#525252' },
  { main: '#6B6B6B', light: '#999999', dark: '#4A4A4A' },
  { main: '#808080', light: '#B0B0B0', dark: '#5C5C5C' },
  { main: '#666666', light: '#949494', dark: '#454545' },
  { main: '#787878', light: '#A8A8A8', dark: '#555555' },
  { main: '#707070', light: '#9E9E9E', dark: '#4F4F4F' },
  { main: '#858585', light: '#B5B5B5', dark: '#606060' },
  { main: '#626262', light: '#909090', dark: '#424242' },
]

/** Accent-family shades per color theme (warm pastels). */
const THEMED_PALETTES: Record<'blue' | 'sepia' | 'green', AvatarPalette[]> = {
  blue: [
    { main: '#6B9DC9', light: '#93B8D9', dark: '#4A7A9B' },
    { main: '#7BAFD4', light: '#A8CCE8', dark: '#5A89B5' },
    { main: '#5A8AB8', light: '#8CB4D9', dark: '#3D6A8A' },
    { main: '#93B8D9', light: '#B5D4EA', dark: '#6B9DC9' },
    { main: '#4A8AB5', light: '#7BAFD4', dark: '#356888' },
    { main: '#8CB4D9', light: '#C4DFF5', dark: '#5A89B5' },
    { main: '#6B9DC9', light: '#A8CCE8', dark: '#4A7A9B' },
    { main: '#5A89B5', light: '#93B8D9', dark: '#3D6A8A' },
  ],
  sepia: [
    { main: '#C4956A', light: '#D4B896', dark: '#A08060' },
    { main: '#D4B896', light: '#E0C4A8', dark: '#B08055' },
    { main: '#B89570', light: '#C9A882', dark: '#907050' },
    { main: '#C9A882', light: '#E8D0B8', dark: '#A8856A' },
    { main: '#A8856A', light: '#C4956A', dark: '#806040' },
    { main: '#E0C4A8', light: '#F0E0D0', dark: '#C4956A' },
    { main: '#B08055', light: '#D4B896', dark: '#886040' },
    { main: '#C4956A', light: '#E0C4A8', dark: '#907050' },
  ],
  green: [
    { main: '#7DAF88', light: '#A5C9AD', dark: '#5A8A68' },
    { main: '#8FB996', light: '#B5D4BC', dark: '#6A9A75' },
    { main: '#6A9A75', light: '#8FB996', dark: '#4A7558' },
    { main: '#A5C9AD', light: '#C4DFC8', dark: '#7DAF88' },
    { main: '#5A8A68', light: '#7DAF88', dark: '#3D6A48' },
    { main: '#B5D4BC', light: '#D4E8D8', dark: '#8FB996' },
    { main: '#7DAF88', light: '#B5D4BC', dark: '#5A8A68' },
    { main: '#6A9A75', light: '#A5C9AD', dark: '#4A7558' },
  ],
}

export function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

function palettesFor(id: PaletteId): AvatarPalette[] {
  if (id === 'mono') return MONO_PALETTES
  if (id === 'blue' || id === 'sepia' || id === 'green') return THEMED_PALETTES[id]
  return AVATAR_PALETTES
}

export function getPalette(seed: string, paletteId?: PaletteId): AvatarPalette {
  const id = paletteId ?? getActivePalette()
  const list = palettesFor(id)
  return list[hashString(seed) % list.length]
}

/** Primary accent hex for borders, pills, progress bars. */
export function avatarColor(seed: string, paletteId?: PaletteId): string {
  return getPalette(seed, paletteId).main
}

export function avatarInitials(seed: string, kind: 'band' | 'user' = 'band'): string {
  if (kind === 'user') {
    return seed.replace(/^@/, '').slice(0, 2).toUpperCase()
  }
  return seed
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function avatarCssVars(seed: string, paletteId?: PaletteId): Record<string, string> {
  const p = getPalette(seed, paletteId)
  return {
    '--av-main': p.main,
    '--av-light': p.light,
    '--av-dark': p.dark,
  }
}

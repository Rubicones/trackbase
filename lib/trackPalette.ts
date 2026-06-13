/** Mixer track / waveform colors — follow the active color theme. */

import type { PaletteId } from '@/lib/palettes'
import { getActivePalette, usesMonoTracks } from '@/lib/palettes'
import { TRACK_ICON_COLORS } from '@/lib/trackIcon'

export type TrackColor = { bg: string; bgLight: string; fg: string }

const DEFAULT_TRACK_PALETTE: TrackColor[] = [
  { bg: 'rgba(167,139,250,0.12)', bgLight: '#ede9ff', fg: '#a78bfa' },
  { bg: 'rgba(52,211,153,0.12)', bgLight: '#d4eed4', fg: '#34d399' },
  { bg: 'rgba(251,191,36,0.12)', bgLight: '#f5e6c8', fg: '#fbbf24' },
  { bg: 'rgba(248,113,113,0.12)', bgLight: '#fde8e8', fg: '#f87171' },
  { bg: 'rgba(96,165,250,0.12)', bgLight: '#dbeafe', fg: '#60a5fa' },
  { bg: 'rgba(232,121,249,0.12)', bgLight: '#fce7f3', fg: '#e879f9' },
]

/** One shared waveform color per mono / color theme (not per track index). */
const MONO_TRACK_LIGHT: TrackColor = {
  fg: '#888888',
  bg: 'rgba(136,136,136,0.14)',
  bgLight: '#E8E8E8',
}

const MONO_TRACK_DARK: TrackColor = {
  fg: '#B0B0B0',
  bg: 'rgba(176,176,176,0.12)',
  bgLight: '#2A2A2A',
}

const BLUE_TRACK: TrackColor = {
  fg: '#6B9DC9',
  bg: 'rgba(107,157,201,0.14)',
  bgLight: '#E4EDF5',
}

const SEPIA_TRACK: TrackColor = {
  fg: '#C4956A',
  bg: 'rgba(196,149,106,0.14)',
  bgLight: '#F0E4D4',
}

const GREEN_TRACK: TrackColor = {
  fg: '#7DAF88',
  bg: 'rgba(125,175,136,0.14)',
  bgLight: '#E4F0E6',
}

/** Visible icon-picker swatches — always colorful / distinct (not washed-out track bg). */
const COLORFUL_ICON_SWATCHES = TRACK_ICON_COLORS

const BLUE_ICON_SWATCHES = [
  'rgba(107,157,201,0.35)',
  'rgba(147,184,217,0.35)',
  'rgba(74,122,155,0.35)',
  'rgba(140,180,217,0.35)',
  'rgba(90,137,181,0.35)',
  'rgba(168,204,232,0.35)',
]

const SEPIA_ICON_SWATCHES = [
  'rgba(196,149,106,0.35)',
  'rgba(212,184,150,0.35)',
  'rgba(168,133,106,0.35)',
  'rgba(184,149,112,0.35)',
  'rgba(201,168,130,0.35)',
  'rgba(224,196,168,0.35)',
]

const GREEN_ICON_SWATCHES = [
  'rgba(125,175,136,0.35)',
  'rgba(165,201,173,0.35)',
  'rgba(90,138,104,0.35)',
  'rgba(143,185,150,0.35)',
  'rgba(106,154,117,0.35)',
  'rgba(181,212,188,0.35)',
]

function usesUnifiedTrackColor(id: PaletteId): boolean {
  return usesMonoTracks(id) || id === 'blue' || id === 'sepia' || id === 'green'
}

function unifiedTrackColor(id: PaletteId, isDark: boolean): TrackColor {
  if (usesMonoTracks(id)) return isDark ? MONO_TRACK_DARK : MONO_TRACK_LIGHT
  switch (id) {
    case 'blue': return BLUE_TRACK
    case 'sepia': return SEPIA_TRACK
    case 'green': return GREEN_TRACK
    default: return MONO_TRACK_LIGHT
  }
}

export function getTrackPalette(paletteId?: PaletteId, isDark = false): TrackColor[] {
  const id = paletteId ?? getActivePalette()
  if (usesUnifiedTrackColor(id)) {
    return [unifiedTrackColor(id, isDark)]
  }
  return DEFAULT_TRACK_PALETTE
}

export function trackColorAt(_index: number, paletteId?: PaletteId, isDark = false): TrackColor {
  const id = paletteId ?? getActivePalette()
  if (usesUnifiedTrackColor(id)) {
    return unifiedTrackColor(id, isDark)
  }
  return DEFAULT_TRACK_PALETTE[_index % DEFAULT_TRACK_PALETTE.length]
}

/** Icon picker swatches — vivid colors for the popover (waveforms may still be mono). */
export function getTrackIconSwatches(paletteId?: PaletteId, _isDark = false): string[] {
  const id = paletteId ?? getActivePalette()
  switch (id) {
    case 'blue':
      return BLUE_ICON_SWATCHES
    case 'sepia':
      return SEPIA_ICON_SWATCHES
    case 'green':
      return GREEN_ICON_SWATCHES
    case 'mono':
    case 'default-mono-tracks':
    case 'default':
    default:
      return COLORFUL_ICON_SWATCHES
  }
}

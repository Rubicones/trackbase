import type { Section } from '@/lib/types'
import { findSectionRangeAtTime } from '@/lib/sectionPlayback'

export interface ParsedChord {
  name: string
  duration: number
}

export interface TimelineChord {
  name: string
  duration: number
  sectionId: string
  /** Index within the section's chord list */
  sectionChordIndex: number
  /** Flat index across all sections */
  globalIndex: number
  /** True when this is the first chord of a section (after a separator) */
  isSectionStart: boolean
  /** Section label shown before the first chord of each section */
  sectionLabel: string
}

const CHORD_NAME_RE = /^[A-Za-z0-9#/]+$/

export function isValidChordName(name: string): boolean {
  return CHORD_NAME_RE.test(name)
}

const DURATION_PRESETS = ['1/2', '1', '2', '4', '8', '16'] as const
export { DURATION_PRESETS }

/** Format bar duration for storage (omit `:1` for default). */
export function formatBarDuration(d: number): string {
  if (Math.abs(d - 1) < 0.001) return '1'
  const fractions: [number, string][] = [
    [0.25, '1/4'],
    [0.5, '1/2'],
    [0.75, '3/4'],
    [1.5, '3/2'],
    [2.5, '5/2'],
  ]
  for (const [val, str] of fractions) {
    if (Math.abs(d - val) < 0.001) return str
  }
  if (Number.isInteger(d)) return String(d)
  return String(d)
}

/** Parse a duration token like "1", "1/2", "4". */
export function parseBarDuration(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes('/')) {
    const parts = s.split('/')
    if (parts.length !== 2) return null
    const num = Number(parts[0])
    const den = Number(parts[1])
    if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null
    return num / den
  }
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Parse one token like "Em", "A#m:4", "Bb:1/2". */
export function parseChordToken(token: string): ParsedChord | null {
  const trimmed = token.trim()
  if (!trimmed) return null
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx === -1) {
    if (!CHORD_NAME_RE.test(trimmed)) return null
    return { name: trimmed, duration: 1 }
  }
  const name = trimmed.slice(0, colonIdx)
  const durStr = trimmed.slice(colonIdx + 1)
  if (!CHORD_NAME_RE.test(name)) return null
  const duration = parseBarDuration(durStr)
  if (duration === null) return null
  return { name, duration }
}

/** Parse a section chords string into structured chords. */
export function parseChordsString(raw: string | null | undefined): ParsedChord[] {
  if (!raw?.trim()) return []
  return raw.trim().split(/\s+/).map(parseChordToken).filter((c): c is ParsedChord => c !== null)
}

/** Serialize structured chords back to storage format. */
export function serializeChords(chords: ParsedChord[]): string {
  return chords
    .filter(c => c.name.trim())
    .map(c => {
      if (Math.abs(c.duration - 1) < 0.001) return c.name
      return `${c.name}:${formatBarDuration(c.duration)}`
    })
    .join(' ')
}

/** Sum of bar durations across all chord tokens. */
export function totalChordBarSpan(raw: string | null | undefined): number {
  return parseChordsString(raw).reduce((sum, c) => sum + c.duration, 0)
}

/** Expand parsed chords into one name per bar. */
export function expandChordsToBarNames(chords: ParsedChord[]): string[] {
  const bars: string[] = []
  for (const c of chords) {
    const count = Math.max(1, Math.round(c.duration))
    for (let i = 0; i < count; i++) bars.push(c.name)
  }
  return bars
}

/**
 * Clamp detected chords to exactly `barCount` bars (truncate or pad with last chord).
 * Used after Essentia detection when section bounds and project length disagree.
 */
export function normalizeChordsToBarCount(raw: string, barCount: number): string {
  if (barCount <= 0) return ''
  const parsed = parseChordsString(raw)
  if (parsed.length === 0) return ''

  let bars = expandChordsToBarNames(parsed)
  if (bars.length > barCount) {
    bars = bars.slice(0, barCount)
  } else if (bars.length < barCount) {
    const pad = bars[bars.length - 1] ?? 'N'
    while (bars.length < barCount) bars.push(pad)
  }

  return serializeChords(collapseConsecutiveChords(bars))
}

/** Bars spanned by a section (exclusive end), capped to the project timeline. */
export function sectionBarCount(
  section: { start_bar: number; end_bar: number },
  projectTotalBars: number,
): number {
  const end = Math.min(section.end_bar, projectTotalBars)
  return Math.max(1, end - section.start_bar)
}

/**
 * @deprecated Use sectionBarCount — detection always follows the section span shown in the UI.
 */
export function computeDetectionBarCount(
  sectionStartBar: number,
  sectionEndBar: number,
  _audioSamples: number,
  _sampleRate: number,
  _barDurationSec: number,
  projectTotalBars: number,
): number {
  return sectionBarCount({ start_bar: sectionStartBar, end_bar: sectionEndBar }, projectTotalBars)
}

/** Collapse consecutive identical chord names into duration counts (for auto-detection). */
export function collapseConsecutiveChords(names: string[]): ParsedChord[] {
  const result: ParsedChord[] = []
  let i = 0
  while (i < names.length) {
    const name = names[i]?.trim()
    if (!name || name === 'N' || name === 'n') {
      i += 1
      continue
    }
    let count = 1
    while (i + count < names.length && names[i + count] === name) {
      count += 1
    }
    result.push({ name, duration: count })
    i += count
  }
  return result
}

/** Format chords for read-only display (names only, with · separator). */
export function formatChordsDisplay(raw: string | null | undefined): string {
  const chords = parseChordsString(raw)
  if (chords.length === 0) return '—'
  return chords.map(c => {
    if (Math.abs(c.duration - 1) < 0.001) return c.name
    return `${c.name}×${formatBarDuration(c.duration)}`
  }).join(' · ')
}

export function updateSectionChordDuration(
  chordsRaw: string | null | undefined,
  sectionChordIndex: number,
  duration: number,
): string {
  const parsed = parseChordsString(chordsRaw)
  if (sectionChordIndex < 0 || sectionChordIndex >= parsed.length) return chordsRaw ?? ''
  parsed[sectionChordIndex] = { ...parsed[sectionChordIndex], duration }
  return serializeChords(parsed)
}

function sectionDisplayName(section: Section): string {
  return section.custom_name ?? (section.type.charAt(0).toUpperCase() + section.type.slice(1))
}

export function buildChordTimeline(sections: Section[]): TimelineChord[] {
  const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar)
  const timeline: TimelineChord[] = []
  let globalIndex = 0

  for (const section of sorted) {
    const parsed = parseChordsString(section.chords)
    parsed.forEach((chord, sectionChordIndex) => {
      timeline.push({
        name: chord.name,
        duration: chord.duration,
        sectionId: section.id,
        sectionChordIndex,
        globalIndex,
        isSectionStart: sectionChordIndex === 0,
        sectionLabel: sectionDisplayName(section),
      })
      globalIndex += 1
    })
  }

  return timeline
}

/** Find active chord global index given current playhead time. */
export function findActiveChordGlobalIndex(
  sections: Section[],
  currentTimeMs: number,
  barDurationMs: number,
): number | null {
  if (barDurationMs <= 0) return null

  const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar)
  const ranges = sorted.map(s => ({ id: s.id, start_bar: s.start_bar, end_bar: s.end_bar }))
  const section = findSectionRangeAtTime(
    ranges,
    currentTimeMs / 1000,
    barDurationMs / 1000,
  )
  if (!section) return null

  const sec = sorted.find(s => s.id === section.id)
  if (!sec) return null

  const chords = parseChordsString(sec.chords)
  if (chords.length === 0) return null

  const barInSection = currentTimeMs / barDurationMs - sec.start_bar
  if (barInSection < 0) return null

  let barOffset = 0
  let activeSectionIndex = chords.length - 1

  for (let i = 0; i < chords.length; i++) {
    const dur = chords[i].duration
    if (barInSection < barOffset + dur) {
      activeSectionIndex = i
      break
    }
    barOffset += dur
  }

  const timeline = buildChordTimeline(sorted)
  const match = timeline.find(
    t => t.sectionId === sec.id && t.sectionChordIndex === activeSectionIndex,
  )
  return match?.globalIndex ?? null
}

/** Filter input to allowed chord characters. */
export function filterChordInputChar(char: string): string {
  if (/[A-Za-z0-9#/]/.test(char)) return char
  return ''
}

import type { Section } from '@/lib/types'

export interface SectionRange {
  id: string
  start_bar: number
  end_bar: number
}

/** Map each bar index to its section id, or null when no section covers that bar. */
export function buildSectionBarMap(sections: Section[], totalBars: number): (string | null)[] {
  const map: (string | null)[] = new Array(Math.max(0, totalBars)).fill(null)
  for (const s of sections) {
    for (let b = s.start_bar; b < s.end_bar && b < totalBars; b++) {
      map[b] = s.id
    }
  }
  return map
}

export function buildSectionRanges(sections: Section[]): SectionRange[] {
  return [...sections]
    .sort((a, b) => a.start_bar - b.start_bar)
    .map(s => ({ id: s.id, start_bar: s.start_bar, end_bar: s.end_bar }))
}

export function findSectionRangeAtBar(ranges: SectionRange[], bar: number): SectionRange | null {
  return ranges.find(r => bar >= r.start_bar && bar < r.end_bar) ?? null
}

/** Match playhead time to a section; tolerates seeks that land slightly before a bar boundary. */
export function findSectionRangeAtTime(
  ranges: SectionRange[],
  timeSec: number,
  barDurationSec: number,
): SectionRange | null {
  if (barDurationSec <= 0) return null
  for (const r of ranges) {
    const start = r.start_bar * barDurationSec
    const end = r.end_bar * barDurationSec
    if (timeSec >= start - 0.005 && timeSec < end) return r
  }
  return null
}

export function sectionRangeToSeconds(
  range: Pick<SectionRange, 'start_bar' | 'end_bar'>,
  barDurationSec: number,
): { startSec: number; endSec: number } {
  return {
    startSec: range.start_bar * barDurationSec,
    endSec: range.end_bar * barDurationSec,
  }
}

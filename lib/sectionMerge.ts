import { Section, SectionType } from './types'

// ─── Bar state ─────────────────────────────────────────────────────────────────

export interface BarState {
  type: SectionType
  customName: string | null
  chords: string | null
  note: string | null
  color: string
}

// ─── Range types ───────────────────────────────────────────────────────────────

/**
 * @deprecated The system is a two-way compare — conflicts no longer exist.
 * Kept only so older clients reading `sectionBarConflicts` (always `[]`) still
 * type-check. Do not produce values of this type.
 */
export interface ConflictRange {
  startBar: number
  endBar: number           // exclusive
  mainState: BarState | null
  branchState: BarState | null
}

/** A group of consecutive bars where the incoming version differs from the target. */
export interface AutoBarRange {
  startBar: number
  endBar: number           // exclusive
  branchState: BarState | null  // null means the bars will become empty (no section)
  /** Target's current state on these bars (what applying would replace). */
  targetState?: BarState | null
  /** Guardrail: the target's content here is newer than the version's. */
  targetNewer?: boolean
}

// ─── buildBarMap ───────────────────────────────────────────────────────────────

/**
 * Map each bar index [0, totalBars) to its BarState, or null if no section covers it.
 * Sections that extend past totalBars are clamped.
 */
export function buildBarMap(sections: Section[], totalBars: number): (BarState | null)[] {
  const map: (BarState | null)[] = new Array(totalBars).fill(null)
  for (const s of sections) {
    const state: BarState = {
      type: s.type,
      customName: s.custom_name,
      chords: s.chords,
      note: s.note ?? null,
      color: s.color,
    }
    for (let b = s.start_bar; b < s.end_bar && b < totalBars; b++) {
      map[b] = state
    }
  }
  return map
}

// ─── barStatesEqual ────────────────────────────────────────────────────────────

/**
 * Semantic equality. Color is intentionally excluded — it's presentation-only
 * and derived from type.
 */
export function barStatesEqual(a: BarState | null, b: BarState | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.type === b.type && a.customName === b.customName && a.chords === b.chords && a.note === b.note
}

// ─── diffBarMaps ───────────────────────────────────────────────────────────────

/**
 * Two-way bar comparison: the ONLY structure-diff primitive in the system.
 *
 * A bar is a change when the incoming version's state differs from the target's.
 * Consecutive changed bars sharing the same (branchState, targetState) pair are
 * grouped into one range, so each range is homogeneous: applying it sets every
 * bar to `branchState`, skipping it keeps every bar at `targetState`.
 *
 * Deterministic: same two section sets always produce the same ranges (bar maps
 * are pure functions of the section rows, and grouping is a single linear scan).
 * Both the preview and the apply route call this with the same inputs, so what
 * the user reviews is exactly what gets applied.
 */
export function diffBarMaps(
  branchMap: (BarState | null)[],
  targetMap: (BarState | null)[],
  totalBars: number,
): AutoBarRange[] {
  const ranges: AutoBarRange[] = []

  let i = 0
  while (i < totalBars) {
    const branch = branchMap[i] ?? null
    const target = targetMap[i] ?? null

    if (barStatesEqual(branch, target)) { i++; continue }

    const startBar = i
    let   endBar   = i + 1
    while (endBar < totalBars) {
      const br2 = branchMap[endBar] ?? null
      const tg2 = targetMap[endBar] ?? null
      // Still a difference AND the same homogeneous (branch, target) pair
      if (barStatesEqual(br2, tg2)) break
      if (!barStatesEqual(br2, branch) || !barStatesEqual(tg2, target)) break
      endBar++
    }
    ranges.push({ startBar, endBar, branchState: branch, targetState: target })
    i = endBar
  }

  return ranges
}

// ─── barMapToSections ──────────────────────────────────────────────────────────

/**
 * Convert a bar map back into Section rows ready for insertion.
 * Consecutive bars with semantically equal states are merged into one section.
 */
export function barMapToSections(
  barMap:    (BarState | null)[],
  versionId: string,
  projectId: string,
): Omit<Section, 'id' | 'created_at'>[] {
  const sections: Omit<Section, 'id' | 'created_at'>[] = []
  let i = 0
  let position = 0

  while (i < barMap.length) {
    const state = barMap[i]
    if (state === null) { i++; continue }

    let j = i + 1
    while (j < barMap.length && barStatesEqual(barMap[j], state)) j++

    sections.push({
      version_id: versionId,
      project_id: projectId,
      type:        state.type,
      custom_name: state.customName,
      start_bar:   i,
      end_bar:     j,
      chords:      state.chords,
      note:        state.note,
      color:       state.color,
      position:    position++,
    })
    i = j
  }

  return sections
}

// ─── calculateTotalBars ────────────────────────────────────────────────────────

/**
 * Derive totalBars from the maximum end_bar seen across any set of sections.
 * Falls back to 1 so bar maps are never empty.
 */
export function calculateTotalBars(...sectionSets: Section[][]): number {
  let max = 0
  for (const set of sectionSets) {
    for (const s of set) {
      if (s.end_bar > max) max = s.end_bar
    }
  }
  return Math.max(max, 1)
}

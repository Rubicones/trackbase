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

/** A group of consecutive bars where branch and main diverge (both changed from base). */
export interface ConflictRange {
  startBar: number
  endBar: number           // exclusive
  mainState: BarState | null
  branchState: BarState | null
}

/** A group of consecutive bars changed only in branch — auto-applies to main. */
export interface AutoBarRange {
  startBar: number
  endBar: number           // exclusive
  branchState: BarState | null  // null means the bars will become empty (no section)
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

// ─── groupConsecutiveBars ──────────────────────────────────────────────────────

/**
 * Three-way bar comparison producing two outputs:
 *
 *  conflicts      — bars changed in BOTH branch and main, with different end-states.
 *                   Consecutive bars with the same (branchState, mainState) pair are
 *                   grouped into one ConflictRange.
 *
 *  autoFromBranch — bars changed only in branch (not a conflict).
 *                   Consecutive bars with the same branchState are grouped.
 */
export function groupConsecutiveBars(
  baseMap:   (BarState | null)[],
  branchMap: (BarState | null)[],
  mainMap:   (BarState | null)[],
  totalBars: number,
): { conflicts: ConflictRange[]; autoFromBranch: AutoBarRange[] } {
  const conflicts:      ConflictRange[]  = []
  const autoFromBranch: AutoBarRange[]   = []

  let i = 0
  while (i < totalBars) {
    const base   = baseMap[i]   ?? null
    const branch = branchMap[i] ?? null
    const main   = mainMap[i]   ?? null

    const changedInBranch = !barStatesEqual(base, branch)
    const changedInMain   = !barStatesEqual(base, main)
    const isConflict      = changedInBranch && changedInMain && !barStatesEqual(branch, main)
    const isAuto          = changedInBranch && !isConflict

    if (isConflict) {
      const startBar = i
      let   endBar   = i + 1
      while (endBar < totalBars) {
        const b2  = baseMap[endBar]   ?? null
        const br2 = branchMap[endBar] ?? null
        const m2  = mainMap[endBar]   ?? null
        const cb2 = !barStatesEqual(b2, br2)
        const cm2 = !barStatesEqual(b2, m2)
        const ic2 = cb2 && cm2 && !barStatesEqual(br2, m2)
        // Must still be a conflict AND share the same (branch, main) state pair
        if (!ic2) break
        if (!barStatesEqual(br2, branch) || !barStatesEqual(m2, main)) break
        endBar++
      }
      conflicts.push({ startBar, endBar, mainState: main, branchState: branch })
      i = endBar
    } else if (isAuto) {
      const startBar = i
      let   endBar   = i + 1
      while (endBar < totalBars) {
        const b2  = baseMap[endBar]   ?? null
        const br2 = branchMap[endBar] ?? null
        const m2  = mainMap[endBar]   ?? null
        const cb2 = !barStatesEqual(b2, br2)
        const cm2 = !barStatesEqual(b2, m2)
        const ic2 = cb2 && cm2 && !barStatesEqual(br2, m2)
        // Must still be auto (changed in branch, not a conflict) AND same branch state
        if (!cb2 || ic2) break
        if (!barStatesEqual(br2, branch)) break
        endBar++
      }
      autoFromBranch.push({ startBar, endBar, branchState: branch })
      i = endBar
    } else {
      i++
    }
  }

  return { conflicts, autoFromBranch }
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

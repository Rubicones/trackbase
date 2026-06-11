/** Bar offset on the project timeline (0 = starts at bar 1). */
export function trackStartBar(
  t: { start_bar?: number | null; midi_start_bar?: number | null } | null | undefined,
): number {
  if (!t) return 0
  return t.start_bar ?? t.midi_start_bar ?? 0
}

/** Human-readable bar label (1-indexed). */
export function formatTrackStartBar(startBar: number): string {
  return startBar === 0 ? 'Bar 1' : `Bar ${startBar + 1}`
}

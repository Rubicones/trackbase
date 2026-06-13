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

/** Minimal track fields needed for timeline duration. */
export type TimelineTrack = {
  duration_ms?: number | null
  start_bar?: number | null
  midi_start_bar?: number | null
  file_type?: string | null
  midi_data?: { notes?: { startSixteenth: number; durationSixteenths: number }[] } | null
}

function trackContentDurationMs(t: TimelineTrack, bpm: number): number {
  if (t.file_type === 'midi' && t.midi_data?.notes?.length) {
    const sixthMs = (60 / bpm / 4) * 1000
    const lastEnd = Math.max(...t.midi_data.notes.map(n => n.startSixteenth + n.durationSixteenths))
    return Math.ceil(lastEnd * sixthMs)
  }
  return t.duration_ms ?? 0
}

/** End position on the project timeline in ms (start_bar offset + track content). */
export function trackTimelineEndMs(
  t: TimelineTrack,
  bpm: number,
  timeSignature = '4/4',
): number {
  const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4
  const barDurMs = (60000 / bpm) * beatsPerBar
  const startMs = trackStartBar(t) * barDurMs
  return startMs + trackContentDurationMs(t, bpm)
}

/** Longest point on the project timeline — matches the project page player duration. */
export function projectTimelineDurationMs(
  tracks: TimelineTrack[],
  bpm?: number | null,
  timeSignature?: string | null,
): number {
  if (!tracks.length) return 0
  const projBpm = bpm ?? 120
  const projTs = timeSignature ?? '4/4'
  let max = 0
  for (const t of tracks) {
    max = Math.max(max, trackTimelineEndMs(t, projBpm, projTs))
  }
  return max
}

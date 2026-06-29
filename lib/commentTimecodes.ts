import type { TrackComment } from '@/lib/types'

/** Project-timeline ms offset for a track's start_bar. */
export function barOffsetToMs(startBar: number, bpm: number, timeSignature: string): number {
  const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar
  return startBar * barDurationMs
}

/** Track-content ms → project-timeline ms. */
export function commentToTimelineMs(
  trackRelativeMs: number,
  startBar: number,
  bpm: number,
  timeSignature: string,
): number {
  return trackRelativeMs + barOffsetToMs(startBar, bpm, timeSignature)
}

/** Project-timeline ms → track-content ms. */
export function commentToTrackRelativeMs(
  timelineMs: number,
  startBar: number,
  bpm: number,
  timeSignature: string,
): number {
  return timelineMs - barOffsetToMs(startBar, bpm, timeSignature)
}

/** Map comments to project-timeline ms (mobile mixer / chat context). */
export function commentsToTimeline(
  comments: TrackComment[],
  startBar: number,
  bpm: number,
  timeSignature: string,
): TrackComment[] {
  const offsetMs = barOffsetToMs(startBar, bpm, timeSignature)
  if (!offsetMs || !comments.length) return comments
  return comments.map(c => ({
    ...c,
    timecode_start_ms: c.timecode_start_ms + offsetMs,
    timecode_end_ms: c.timecode_end_ms + offsetMs,
  }))
}

/** @deprecated Legacy helper — comments are stored track-relative now. */
export function shiftCommentsByBarDelta(
  comments: TrackComment[],
  barDelta: number,
  bpm: number,
  timeSignature: string,
): TrackComment[] {
  if (!barDelta || !comments.length) return comments
  const deltaMs = barOffsetToMs(barDelta, bpm, timeSignature)
  return comments.map(c => ({
    ...c,
    timecode_start_ms: c.timecode_start_ms + deltaMs,
    timecode_end_ms: c.timecode_end_ms + deltaMs,
  }))
}

/** @deprecated Legacy helper — comments are stored track-relative now. */
export function commentsRelativeToTrack(
  comments: TrackComment[],
  startBar: number,
  bpm: number,
  timeSignature: string,
): TrackComment[] {
  const offsetMs = barOffsetToMs(startBar, bpm, timeSignature)
  return comments.map(c => ({
    ...c,
    timecode_start_ms: c.timecode_start_ms - offsetMs,
    timecode_end_ms: c.timecode_end_ms - offsetMs,
  }))
}

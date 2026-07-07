/**
 * Non-destructive track edit session model.
 *
 * Everything here works in whole-bar units on the project timeline. A session
 * describes the edited track as a list of non-overlapping SEGMENTS; each
 * segment is a contiguous run of audio tiled by CLIPS that reference
 * bar-aligned ranges of the ORIGINAL source file. No audio is touched until
 * the user applies, at which point the segment list is rendered server-side
 * with ffmpeg into a single new file (leading/gap silence baked in,
 * start_bar reset to 0).
 *
 * Ableton-style semantics:
 *  - Separate splits a segment at the playhead into two segments.
 *  - Remove deletes the selected bar range (gap when not at segment edges).
 *  - Segment edge handles trim audio or extend back into previously trimmed
 *    source material (up to the original file bounds).
 *  - Duplicate/paste OVERWRITE the destination range (nothing shifts) and
 *    merge any segments they touch or span.
 *  - Segments can never overlap and can never start before bar 0.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Bar-aligned reference into the original source file. */
export interface EditClip {
  /** Bar offset into the source file's own bar grid (0 = file start). */
  srcBar: number
  /** Length in bars (≥ 1). */
  lenBars: number
}

/** Contiguous run of audio on the project timeline. */
export interface EditSegment {
  id: string
  /** Timeline bar where this segment starts (≥ 0). */
  startBar: number
  /** Clips tiling the segment back-to-back. */
  clips: EditClip[]
}

export interface TrackEditState {
  segments: EditSegment[]
}

/** Timeline bar range, end-exclusive. */
export interface EditSelection {
  startBar: number
  endBar: number
}

export interface EditClipboard {
  lenBars: number
  clips: EditClip[]
}

/** Full session (kept in React state; every op returns a new session). */
export interface TrackEditSession {
  trackId: string
  /** Track content length in source bars (ceil of duration / bar duration). */
  contentBars: number
  initial: TrackEditState
  state: TrackEditState
  history: TrackEditState[]
  future: TrackEditState[]
  selection: EditSelection | null
  clipboard: EditClipboard | null
}

/** One schedulable slice for live Web Audio preview / server rendering. */
export interface EditPreviewPiece {
  /** Timeline position in seconds. */
  timelineSec: number
  /** Offset into the source buffer in seconds. */
  srcSec: number
  /** Audible duration in seconds (may be shorter than the bar slot). */
  durSec: number
}

// ─── Bar math ─────────────────────────────────────────────────────────────────

export function barDurationSecFor(bpm: number, timeSignature: string | null): number {
  const beatsPerBar = parseInt((timeSignature ?? '4/4').split('/')[0], 10) || 4
  return (60 / bpm) * beatsPerBar
}

/** Number of source bars a file of `durationSec` occupies (last bar may be partial). */
export function contentBarsFor(durationSec: number, barDurSec: number): number {
  if (barDurSec <= 0 || durationSec <= 0) return 1
  return Math.max(1, Math.ceil(durationSec / barDurSec - 1e-6))
}

// ─── Segment helpers ──────────────────────────────────────────────────────────

let segmentIdCounter = 0
function newSegmentId(): string {
  segmentIdCounter += 1
  return `eseg-${segmentIdCounter}`
}

export function clipsLenBars(clips: EditClip[]): number {
  return clips.reduce((sum, c) => sum + c.lenBars, 0)
}

export function segmentLenBars(seg: EditSegment): number {
  return clipsLenBars(seg.clips)
}

export function segmentEndBar(seg: EditSegment): number {
  return seg.startBar + segmentLenBars(seg)
}

/** Highest occupied bar (end-exclusive) across all segments. */
export function editStateEndBar(state: TrackEditState): number {
  return state.segments.reduce((max, s) => Math.max(max, segmentEndBar(s)), 0)
}

function sortSegments(segments: EditSegment[]): EditSegment[] {
  return [...segments].sort((a, b) => a.startBar - b.startBar)
}

/** Merge adjacent clips that reference contiguous source ranges. */
function normalizeClips(clips: EditClip[]): EditClip[] {
  const out: EditClip[] = []
  for (const c of clips) {
    if (c.lenBars <= 0) continue
    const prev = out[out.length - 1]
    if (prev && prev.srcBar + prev.lenBars === c.srcBar) {
      out[out.length - 1] = { srcBar: prev.srcBar, lenBars: prev.lenBars + c.lenBars }
    } else {
      out.push({ ...c })
    }
  }
  return out
}

/** Extract a sub-range (offsetBars, lenBars) from a clip list. */
export function sliceClips(clips: EditClip[], offsetBars: number, lenBars: number): EditClip[] {
  const out: EditClip[] = []
  let remainingSkip = offsetBars
  let remainingTake = lenBars
  for (const c of clips) {
    if (remainingTake <= 0) break
    if (remainingSkip >= c.lenBars) {
      remainingSkip -= c.lenBars
      continue
    }
    const start = remainingSkip
    const take = Math.min(c.lenBars - start, remainingTake)
    out.push({ srcBar: c.srcBar + start, lenBars: take })
    remainingSkip = 0
    remainingTake -= take
  }
  return normalizeClips(out)
}

/** Segment containing timeline bar `bar` (start ≤ bar < end), if any. */
export function segmentAtBar(state: TrackEditState, bar: number): EditSegment | null {
  return state.segments.find(s => s.startBar <= bar && bar < segmentEndBar(s)) ?? null
}

/** True if the timeline bar range [startBar, endBar) is fully inside one segment. */
export function rangeWithinAudio(state: TrackEditState, startBar: number, endBar: number): boolean {
  if (endBar <= startBar) return false
  return state.segments.some(s => s.startBar <= startBar && endBar <= segmentEndBar(s))
}

/** Clips covering a timeline selection (must lie within a single segment). */
export function selectionClips(state: TrackEditState, sel: EditSelection): EditClip[] | null {
  const seg = state.segments.find(
    s => s.startBar <= sel.startBar && sel.endBar <= segmentEndBar(s),
  )
  if (!seg) return null
  return sliceClips(seg.clips, sel.startBar - seg.startBar, sel.endBar - sel.startBar)
}

// ─── Session construction ─────────────────────────────────────────────────────

/**
 * Initial state for a track. Negative start_bar (pre-roll before bar 1) is
 * re-anchored at bar 0 by skipping the pre-roll bars of the source — matching
 * how playback and export already treat audio before bar 0 (inaudible).
 */
export function createInitialEditState(startBar: number, contentBars: number): TrackEditState {
  if (startBar >= 0) {
    return {
      segments: [{ id: newSegmentId(), startBar, clips: [{ srcBar: 0, lenBars: contentBars }] }],
    }
  }
  const skip = Math.min(-startBar, contentBars - 1)
  return {
    segments: [{
      id: newSegmentId(),
      startBar: 0,
      clips: [{ srcBar: skip, lenBars: contentBars - skip }],
    }],
  }
}

export function createEditSession(
  trackId: string,
  startBar: number,
  contentBars: number,
): TrackEditSession {
  const initial = createInitialEditState(startBar, contentBars)
  return {
    trackId,
    contentBars,
    initial,
    state: initial,
    history: [],
    future: [],
    selection: null,
    clipboard: null,
  }
}

export function sessionIsDirty(session: TrackEditSession): boolean {
  return session.history.length > 0 || session.future.length > 0
}

/** Push a new state onto the session (records undo history). */
export function sessionCommit(
  session: TrackEditSession,
  state: TrackEditState,
  selection: EditSelection | null,
): TrackEditSession {
  return {
    ...session,
    state,
    selection,
    history: [...session.history, session.state],
    future: [],
  }
}

export function sessionUndo(session: TrackEditSession): TrackEditSession {
  if (session.history.length === 0) return session
  const prev = session.history[session.history.length - 1]
  return {
    ...session,
    state: prev,
    selection: null,
    history: session.history.slice(0, -1),
    future: [session.state, ...session.future],
  }
}

export function sessionRedo(session: TrackEditSession): TrackEditSession {
  if (session.future.length === 0) return session
  const next = session.future[0]
  return {
    ...session,
    state: next,
    selection: null,
    history: [...session.history, session.state],
    future: session.future.slice(1),
  }
}

// ─── Operations ───────────────────────────────────────────────────────────────

/** Split the segment containing `bar` into two independent segments. */
export function splitAtBar(state: TrackEditState, bar: number): TrackEditState | null {
  const seg = state.segments.find(s => s.startBar < bar && bar < segmentEndBar(s))
  if (!seg) return null
  const offset = bar - seg.startBar
  const left: EditSegment = {
    id: newSegmentId(),
    startBar: seg.startBar,
    clips: sliceClips(seg.clips, 0, offset),
  }
  const right: EditSegment = {
    id: newSegmentId(),
    startBar: bar,
    clips: sliceClips(seg.clips, offset, segmentLenBars(seg) - offset),
  }
  return {
    segments: sortSegments([...state.segments.filter(s => s.id !== seg.id), left, right]),
  }
}

/** Can Separate run at this playhead bar? (strictly inside a segment) */
export function canSplitAtBar(state: TrackEditState, bar: number): boolean {
  return state.segments.some(s => s.startBar < bar && bar < segmentEndBar(s))
}

function segmentSourceRange(seg: EditSegment): { minSrc: number; maxSrcEnd: number } {
  if (seg.clips.length === 0) return { minSrc: 0, maxSrcEnd: 0 }
  const first = seg.clips[0]
  const last = seg.clips[seg.clips.length - 1]
  return { minSrc: first.srcBar, maxSrcEnd: last.srcBar + last.lenBars }
}

/** Clamp a dragged left edge to valid trim/extend bounds. */
export function clampSegmentStartEdge(
  state: TrackEditState,
  segId: string,
  desiredStartBar: number,
  contentBars: number,
): number {
  const seg = state.segments.find(s => s.id === segId)
  if (!seg) return Math.max(0, Math.round(desiredStartBar))
  const oldLen = segmentLenBars(seg)
  const oldStart = seg.startBar
  const oldEnd = oldStart + oldLen
  let newStart = Math.round(desiredStartBar)

  newStart = Math.min(newStart, oldEnd - 1)

  const { minSrc } = segmentSourceRange(seg)
  const minStartFromSource = oldStart - minSrc

  let minStartFromNeighbor = 0
  for (const other of state.segments) {
    if (other.id === segId) continue
    if (segmentEndBar(other) <= oldStart) {
      minStartFromNeighbor = Math.max(minStartFromNeighbor, segmentEndBar(other))
    }
  }
  return Math.max(newStart, minStartFromNeighbor, minStartFromSource, 0)
}

/** Clamp a dragged right edge to valid trim/extend bounds. */
export function clampSegmentEndEdge(
  state: TrackEditState,
  segId: string,
  desiredEndBar: number,
  contentBars: number,
): number {
  const seg = state.segments.find(s => s.id === segId)
  if (!seg) return Math.max(1, Math.round(desiredEndBar))
  const oldLen = segmentLenBars(seg)
  const oldStart = seg.startBar
  const oldEnd = oldStart + oldLen
  let newEnd = Math.round(desiredEndBar)

  newEnd = Math.max(newEnd, oldStart + 1)

  const { maxSrcEnd } = segmentSourceRange(seg)
  const maxEndFromSource = oldEnd + Math.max(0, contentBars - maxSrcEnd)

  let maxEndFromNeighbor = Number.MAX_SAFE_INTEGER
  for (const other of state.segments) {
    if (other.id === segId) continue
    if (other.startBar >= oldEnd) {
      maxEndFromNeighbor = Math.min(maxEndFromNeighbor, other.startBar)
    }
  }
  return Math.min(newEnd, maxEndFromSource, maxEndFromNeighbor)
}

/** Move a segment's left edge (trim or extend into trimmed source). Right edge stays fixed. */
export function setSegmentStartEdge(
  state: TrackEditState,
  segId: string,
  desiredStartBar: number,
  contentBars: number,
): TrackEditState | null {
  const seg = state.segments.find(s => s.id === segId)
  if (!seg) return null
  const oldLen = segmentLenBars(seg)
  const oldStart = seg.startBar
  const oldEnd = oldStart + oldLen
  const newStart = clampSegmentStartEdge(state, segId, desiredStartBar, contentBars)
  if (newStart === oldStart) return state

  const delta = newStart - oldStart
  let newClips: EditClip[]
  if (delta >= 0) {
    newClips = sliceClips(seg.clips, delta, oldLen - delta)
  } else {
    const ext = -delta
    const first = seg.clips[0]
    newClips = normalizeClips([
      { srcBar: first.srcBar - ext, lenBars: first.lenBars + ext },
      ...seg.clips.slice(1),
    ])
  }
  if (newClips.length === 0 || clipsLenBars(newClips) < 1) return null
  return {
    segments: sortSegments(
      state.segments.map(s =>
        s.id === segId ? { ...s, startBar: newStart, clips: newClips } : s,
      ),
    ),
  }
}

/** Move a segment's right edge (trim or extend into trimmed source). Left edge stays fixed. */
export function setSegmentEndEdge(
  state: TrackEditState,
  segId: string,
  desiredEndBar: number,
  contentBars: number,
): TrackEditState | null {
  const seg = state.segments.find(s => s.id === segId)
  if (!seg) return null
  const oldLen = segmentLenBars(seg)
  const oldStart = seg.startBar
  const oldEnd = oldStart + oldLen
  const newEnd = clampSegmentEndEdge(state, segId, desiredEndBar, contentBars)
  if (newEnd === oldEnd) return state

  const delta = oldEnd - newEnd
  let newClips: EditClip[]
  if (delta >= 0) {
    newClips = sliceClips(seg.clips, 0, oldLen - delta)
  } else {
    const ext = -delta
    const last = seg.clips[seg.clips.length - 1]
    newClips = normalizeClips([
      ...seg.clips.slice(0, -1),
      { srcBar: last.srcBar, lenBars: last.lenBars + ext },
    ])
  }
  if (newClips.length === 0 || clipsLenBars(newClips) < 1) return null
  return {
    segments: sortSegments(
      state.segments.map(s =>
        s.id === segId ? { ...s, clips: newClips } : s,
      ),
    ),
  }
}

/** Can Remove run? (non-empty selection fully inside one segment) */
export function canRemoveSelection(state: TrackEditState, sel: EditSelection | null): boolean {
  if (!sel || sel.endBar <= sel.startBar) return false
  return rangeWithinAudio(state, sel.startBar, sel.endBar)
}

/** Remove the selected bar range (creates a gap when not at segment edges). */
export function removeSelection(state: TrackEditState, sel: EditSelection): TrackEditState | null {
  if (!rangeWithinAudio(state, sel.startBar, sel.endBar)) return null
  const seg = state.segments.find(
    s => s.startBar <= sel.startBar && sel.endBar <= segmentEndBar(s),
  )
  if (!seg) return null
  const len = segmentLenBars(seg)
  const relStart = sel.startBar - seg.startBar
  const relEnd = sel.endBar - seg.startBar
  const removeLen = relEnd - relStart
  if (removeLen <= 0) return null

  if (relStart === 0 && relEnd === len) {
    return { segments: state.segments.filter(s => s.id !== seg.id) }
  }
  if (relStart === 0) {
    return setSegmentStartEdge(state, seg.id, sel.endBar, Number.MAX_SAFE_INTEGER)
  }
  if (relEnd === len) {
    return setSegmentEndEdge(state, seg.id, sel.startBar, Number.MAX_SAFE_INTEGER)
  }

  const left: EditSegment = {
    id: newSegmentId(),
    startBar: seg.startBar,
    clips: sliceClips(seg.clips, 0, relStart),
  }
  const right: EditSegment = {
    id: newSegmentId(),
    startBar: sel.endBar,
    clips: sliceClips(seg.clips, relEnd, len - relEnd),
  }
  if (clipsLenBars(left.clips) < 1 || clipsLenBars(right.clips) < 1) return null
  return {
    segments: sortSegments([
      ...state.segments.filter(s => s.id !== seg.id),
      left,
      right,
    ]),
  }
}

/**
 * Clamp a desired start bar for a segment move: never below bar 0, never
 * overlapping the neighbouring segments (segments can't be dragged past
 * each other).
 */
export function clampSegmentStart(
  state: TrackEditState,
  segId: string,
  desiredStartBar: number,
): number {
  const seg = state.segments.find(s => s.id === segId)
  if (!seg) return Math.max(0, desiredStartBar)
  const len = segmentLenBars(seg)
  let lo = 0
  let hi = Number.MAX_SAFE_INTEGER
  for (const other of state.segments) {
    if (other.id === segId) continue
    if (segmentEndBar(other) <= seg.startBar) lo = Math.max(lo, segmentEndBar(other))
    if (other.startBar >= segmentEndBar(seg)) hi = Math.min(hi, other.startBar - len)
  }
  return Math.max(lo, Math.min(hi, Math.round(desiredStartBar)))
}

/** Move a whole segment to a new start bar (already clamped by caller or re-clamped here). */
export function moveSegment(
  state: TrackEditState,
  segId: string,
  newStartBar: number,
): TrackEditState {
  const clamped = clampSegmentStart(state, segId, newStartBar)
  return {
    segments: sortSegments(
      state.segments.map(s => (s.id === segId ? { ...s, startBar: clamped } : s)),
    ),
  }
}

/**
 * Overwrite the timeline range starting at `destBar` with `clips`.
 * Existing content in the range is replaced (nothing shifts); any segments
 * the written range overlaps OR touches are merged into one segment.
 */
export function writeRange(
  state: TrackEditState,
  destBar: number,
  clips: EditClip[],
): TrackEditState {
  const len = clipsLenBars(clips)
  if (len <= 0) return state
  const destEnd = destBar + len

  const affected = state.segments.filter(
    s => segmentEndBar(s) >= destBar && s.startBar <= destEnd,
  )
  const untouched = state.segments.filter(s => !affected.includes(s))

  let mergedStart = destBar
  let leftClips: EditClip[] = []
  let rightClips: EditClip[] = []
  for (const seg of affected) {
    if (seg.startBar < destBar) {
      leftClips = sliceClips(seg.clips, 0, destBar - seg.startBar)
      mergedStart = seg.startBar
    }
    const end = segmentEndBar(seg)
    if (end > destEnd) {
      rightClips = sliceClips(seg.clips, destEnd - seg.startBar, end - destEnd)
    }
  }

  const merged: EditSegment = {
    id: newSegmentId(),
    startBar: mergedStart,
    clips: normalizeClips([...leftClips, ...clips.map(c => ({ ...c })), ...rightClips]),
  }
  return { segments: sortSegments([...untouched, merged]) }
}

/** Duplicate the selection immediately after itself (overwriting). */
export function duplicateSelection(
  state: TrackEditState,
  sel: EditSelection,
): { state: TrackEditState; selection: EditSelection } | null {
  const clips = selectionClips(state, sel)
  if (!clips || clips.length === 0) return null
  const len = sel.endBar - sel.startBar
  const next = writeRange(state, sel.endBar, clips)
  return { state: next, selection: { startBar: sel.endBar, endBar: sel.endBar + len } }
}

/** Paste clipboard content at the playhead bar (overwriting). */
export function pasteAt(
  state: TrackEditState,
  playheadBar: number,
  clipboard: EditClipboard,
): { state: TrackEditState; endBar: number } | null {
  if (playheadBar < 0 || clipboard.clips.length === 0) return null
  const next = writeRange(state, playheadBar, clipboard.clips)
  return { state: next, endBar: playheadBar + clipboard.lenBars }
}

// ─── Preview / render pieces ──────────────────────────────────────────────────

/**
 * Flatten the edit state into schedulable buffer slices for the Web Audio
 * live preview. `fileDurSec` is the decoded duration of the original source;
 * a clip covering the source's final partial bar plays only the audio that
 * exists (the rest of its bar slot is silent), exactly like the rendered
 * output.
 */
export function editStatePreviewPieces(
  state: TrackEditState,
  barDurSec: number,
  fileDurSec: number,
): EditPreviewPiece[] {
  const pieces: EditPreviewPiece[] = []
  for (const seg of sortSegments(state.segments)) {
    let cursorBar = seg.startBar
    for (const clip of seg.clips) {
      const srcSec = clip.srcBar * barDurSec
      const durSec = Math.min(clip.lenBars * barDurSec, Math.max(0, fileDurSec - srcSec))
      if (durSec > 0.0005) {
        pieces.push({ timelineSec: cursorBar * barDurSec, srcSec, durSec })
      }
      cursorBar += clip.lenBars
    }
  }
  return pieces
}

/** Serializable payload for the server-side apply/render endpoint. */
export function editStateToPayload(state: TrackEditState): {
  segments: { startBar: number; clips: { srcBar: number; lenBars: number }[] }[]
} {
  return {
    segments: sortSegments(state.segments).map(s => ({
      startBar: s.startBar,
      clips: s.clips.map(c => ({ srcBar: c.srcBar, lenBars: c.lenBars })),
    })),
  }
}

/** Per-segment display info for the edit-mode UI. */
export interface SegmentDisplay {
  id: string
  startBar: number
  lenBars: number
}

export function segmentDisplays(state: TrackEditState): SegmentDisplay[] {
  return sortSegments(state.segments).map(s => ({
    id: s.id,
    startBar: s.startBar,
    lenBars: segmentLenBars(s),
  }))
}

/** Preview segment after a trim drag (does not mutate state). */
export function previewTrimmedSegment(
  state: TrackEditState,
  segId: string,
  trim: { startBar?: number; endBar?: number },
  contentBars: number,
): EditSegment | null {
  const orig = state.segments.find(s => s.id === segId)
  if (!orig) return null
  let working = state
  let seg = orig
  if (trim.startBar != null && trim.startBar !== seg.startBar) {
    const next = setSegmentStartEdge(working, segId, trim.startBar, contentBars)
    if (!next) return orig
    working = next
    seg = working.segments.find(s => s.id === segId) ?? orig
  }
  if (trim.endBar != null && trim.endBar !== segmentEndBar(seg)) {
    const next = setSegmentEndEdge(working, segId, trim.endBar, contentBars)
    if (!next) return seg
    seg = next.segments.find(s => s.id === segId) ?? seg
  }
  return seg
}

/**
 * Build waveform bar amplitudes for one segment by mapping its clips back to
 * the source waveform bins (the 96-bin amplitude array cached per track).
 * `displayCount` bars are distributed across the segment's timeline length.
 */
export function segmentWaveformBars(
  sourceBins: number[],
  seg: EditSegment,
  contentBars: number,
  displayCount: number,
): number[] {
  const totalLen = segmentLenBars(seg)
  const bins = sourceBins.length
  if (totalLen <= 0 || bins === 0 || displayCount <= 0) {
    return Array.from({ length: Math.max(1, displayCount) }, () => 0.15)
  }

  // Timeline bar (relative to segment start) → source bar, via clip tiling.
  const srcBarForSegBar = (segBar: number): number | null => {
    let pos = 0
    for (const c of seg.clips) {
      if (segBar < pos + c.lenBars) return c.srcBar + (segBar - pos)
      pos += c.lenBars
    }
    return null
  }

  const out: number[] = []
  const barsPerDisplay = totalLen / displayCount
  for (let i = 0; i < displayCount; i++) {
    const exactBar = i * barsPerDisplay
    const segBar = Math.min(totalLen - 1, Math.floor(exactBar))
    const frac = exactBar - segBar
    const srcBar = srcBarForSegBar(segBar)
    if (srcBar == null) {
      out.push(0.15)
      continue
    }
    // Sample the source bins covering this position within the source bar.
    const binPos = ((srcBar + frac) / contentBars) * bins
    const s = Math.max(0, Math.min(bins - 1, Math.floor(binPos)))
    const e = Math.max(s + 1, Math.min(bins, Math.ceil(((srcBar + Math.min(1, frac + barsPerDisplay)) / contentBars) * bins)))
    let peak = 0
    for (let j = s; j < e; j++) peak = Math.max(peak, sourceBins[j])
    out.push(peak)
  }
  return out
}

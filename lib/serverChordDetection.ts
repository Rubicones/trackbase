import { getServerEssentiaExtractor } from '@/lib/serverEssentia'

/**
 * Server-side counterpart to public/workers/chordsWorker.js (used by the
 * structure editor's "Detect" button via lib/chordDetection.ts). This reuses
 * the exact same pipeline end to end:
 *
 *   1. hpcpExtractor per frame, then ChordsDetection over the whole
 *      sequence (same FRAME_SIZE / HOP_SIZE / CHORD_WINDOW_SEC constants).
 *   2. quantizeChordsByBar's exact mode-vote-per-bar approach — since the
 *      structure editor knows a section's bar count up front and this tool
 *      only has a user-supplied BPM, bar length is derived the same way
 *      the client computes bar numbers (barDurationSec = 60/bpm * 4, 4/4
 *      time), then every bar gets a single chord decision from Essentia,
 *      exactly like the in-app "Detect" button.
 *   3. collapseConsecutiveChords' exact skip-"N"/collapse-repeats logic,
 *      adapted to emit millisecond timestamps instead of bar-run lengths
 *      (the frontend already derives bar numbers from timestamp + BPM).
 *
 * The only real addition is Essentia's standard KeyExtractor call for the
 * "detected key" field the standalone tool needs, which the structure
 * editor pipeline doesn't use — a separate, off-the-shelf Essentia
 * algorithm, not a reimplementation of chord detection.
 */

const FRAME_SIZE = 2048
const HOP_SIZE = 1024
const CHORD_WINDOW_SEC = 2
const BEATS_PER_BAR = 4

export interface DetectedChord {
  timestamp_ms: number
  chord: string
}

export interface ChordAnalysisResult {
  key: string
  duration_seconds: number
  chords: DetectedChord[]
}

function isNoChord(chord: string): boolean {
  const c = chord.trim()
  return c === '' || c === 'N' || c === 'n'
}

/** Most frequent non-N chord in a frame chunk; null if all silence. Mirrors chordsWorker.js's modeChord. */
function modeChord(frames: string[]): string | null {
  const counts = new Map<string, number>()
  for (const raw of frames) {
    const c = raw.trim()
    if (isNoChord(c)) continue
    counts.set(c, (counts.get(c) || 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [chord, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = chord
    }
  }
  return best
}

/**
 * Run Essentia chord + key detection on decoded mono PCM audio.
 * `bpm` determines bar length (60/bpm * 4, assuming 4/4) — Essentia gets one
 * chord decision per bar, exactly like the structure editor's "Detect"
 * button (quantizeChordsByBar in chordsWorker.js).
 */
export function analyzeChordsAndKey(
  pcm: Float32Array,
  sampleRate: number,
  bpm: number,
  durationSeconds: number,
): ChordAnalysisResult {
  const { extractor, wasmModule } = getServerEssentiaExtractor()

  // ── Frame-level HPCP + ChordsDetection (identical to chordsWorker.js) ──
  const pcpSequence = new wasmModule.VectorVectorFloat()
  for (let i = 0; i + FRAME_SIZE <= pcm.length; i += HOP_SIZE) {
    const frame = pcm.subarray(i, i + FRAME_SIZE)
    const hpcpVec = extractor.hpcpExtractor(frame, sampleRate, true)
    pcpSequence.push_back(hpcpVec)
  }

  const rawChords: string[] = []
  if (pcpSequence.size() > 0) {
    const result = extractor.ChordsDetection(pcpSequence, HOP_SIZE, sampleRate, CHORD_WINDOW_SEC)
    const chordsVec = result.chords
    for (let i = 0; i < chordsVec.size(); i++) rawChords.push(chordsVec.get(i))
  }

  // ── Key detection (separate standard Essentia algorithm) ──
  let key = 'Unknown'
  let scale = ''
  try {
    if (pcm.length >= FRAME_SIZE) {
      const keyRes = extractor.KeyExtractor(extractor.arrayToVector(pcm))
      key = keyRes.key
      scale = keyRes.scale
    }
  } catch {
    // Leave key as "Unknown" — a failed key estimate shouldn't fail the whole request.
  }

  // ── Quantize onto bars — one chord per bar, via the exact mode-vote
  // algorithm quantizeChordsByBar uses in chordsWorker.js: for each bar's
  // sample range, take the most frequent non-"N" chord across the hop
  // frames that fall inside it. ──
  const barDurationSec = (60 / bpm) * BEATS_PER_BAR
  const barCount = Math.max(1, Math.ceil(durationSeconds / barDurationSec))
  const barChords: string[] = []
  for (let bar = 0; bar < barCount; bar++) {
    const barStartSample = bar * barDurationSec * sampleRate
    const barEndSample = Math.min((bar + 1) * barDurationSec * sampleRate, pcm.length)
    const startFrame = Math.floor(barStartSample / HOP_SIZE)
    const endFrame = Math.min(Math.ceil(barEndSample / HOP_SIZE), rawChords.length)
    const chunk = startFrame < endFrame ? rawChords.slice(startFrame, endFrame) : []
    barChords.push(modeChord(chunk) ?? 'N')
  }

  // ── Collapse to onset events — collapseConsecutiveChords' exact skip-"N"
  // / skip-repeats logic, emitting a millisecond timestamp per bar instead
  // of a bar-run length (the frontend derives bar numbers from timestamp
  // + BPM using the same formula, so these line up exactly). ──
  const chords: DetectedChord[] = []
  let prev: string | null = null
  for (let bar = 0; bar < barChords.length; bar++) {
    const chord = barChords[bar]
    if (isNoChord(chord)) continue
    if (chord === prev) continue
    chords.push({
      timestamp_ms: Math.round(bar * barDurationSec * 1000),
      chord,
    })
    prev = chord
  }

  return {
    key: scale ? `${key} ${scale}` : key,
    duration_seconds: Math.round(durationSeconds),
    chords,
  }
}

/** bar = floor(timestamp_seconds / (60/bpm) / beats_per_bar) + 1, assuming 4/4. */
export function barNumberForTimestamp(timestampMs: number, bpm: number): number {
  const beatDurationSec = 60 / bpm
  const timestampSec = timestampMs / 1000
  return Math.floor(timestampSec / beatDurationSec / BEATS_PER_BAR) + 1
}

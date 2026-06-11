/* eslint-disable no-undef */
/**
 * Essentia.js chord detection worker.
 * Uses essentia-wasm.umd.js (worker-safe). The .web.js build requires `document`.
 */
const ESSENTIA_VERSION = '0.1.3'
const CDN = `https://cdn.jsdelivr.net/npm/essentia.js@${ESSENTIA_VERSION}/dist`

// UMD WASM build assigns to `exports`; workers have no CommonJS globals.
const exports = {}

importScripts(
  `${CDN}/essentia-wasm.umd.js`,
  `${CDN}/essentia.js-extractor.umd.js`,
)

let extractor = null
let wasmModule = exports.EssentiaWASM

const FRAME_SIZE = 2048
const HOP_SIZE = 1024
const CHORD_WINDOW_SEC = 2

function vectorStringToArray(vec) {
  const out = []
  for (let i = 0; i < vec.size(); i++) out.push(vec.get(i))
  return out
}

function normalizeChordLabel(chord) {
  return (chord ?? '').trim()
}

function isNoChord(chord) {
  const c = normalizeChordLabel(chord)
  return c === '' || c === 'N' || c === 'n'
}

/** Most frequent non-N chord in a frame chunk; null if all silence. */
function modeChord(frames) {
  const counts = new Map()
  for (const raw of frames) {
    const c = normalizeChordLabel(raw)
    if (isNoChord(c)) continue
    counts.set(c, (counts.get(c) || 0) + 1)
  }
  let best = null
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
 * Group frame-by-frame labels into bar chunks; one chord per bar via mode vote.
 * Returns an array with length exactly equal to barCount.
 */
function quantizeChordsByBar(rawChords, barDurationSec, barCount, sampleRate) {
  if (!barCount || barCount <= 0) return []

  const sr = sampleRate || 44100
  const framesPerBar = Math.max(1, Math.round((barDurationSec * sr) / HOP_SIZE))
  const barChords = []

  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * framesPerBar
    const end = Math.min((bar + 1) * framesPerBar, rawChords.length)
    const chunk = start < rawChords.length ? rawChords.slice(start, end) : []
    const mode = modeChord(chunk)
    barChords.push(mode ?? 'N')
  }

  return barChords
}

/**
 * True if `chords` equals `pattern` repeated (final repetition may be truncated).
 */
function patternMatches(chords, pattern) {
  const len = pattern.length
  if (len === 0) return false
  for (let i = 0; i < chords.length; i += 1) {
    if (chords[i] !== pattern[i % len]) return false
  }
  return true
}

/**
 * Fold a bar-quantized progression to its smallest repeating cycle.
 * Keeps the full array when no clean repeat is found.
 */
function foldPattern(chords) {
  if (!chords || chords.length <= 1) return chords ? chords.slice() : []

  const n = chords.length
  for (let len = 1; len <= Math.floor(n / 2); len += 1) {
    const pattern = chords.slice(0, len)
    if (n > len && patternMatches(chords, pattern)) {
      return pattern
    }
  }

  return chords.slice()
}

function formatBarChords(barChords) {
  return foldPattern(barChords).join(' ')
}

function detectChords(audioData, sampleRate, barDurationSec, barCount) {
  if (!extractor || !audioData || audioData.length < FRAME_SIZE) {
    return formatBarChords(quantizeChordsByBar([], barDurationSec, barCount, sampleRate))
  }

  const sr = sampleRate || 44100
  const pcpSequence = new wasmModule.VectorVectorFloat()

  for (let i = 0; i + FRAME_SIZE <= audioData.length; i += HOP_SIZE) {
    const frame = audioData.subarray(i, i + FRAME_SIZE)
    const hpcpVec = extractor.hpcpExtractor(frame, sr, true)
    pcpSequence.push_back(hpcpVec)
  }

  if (pcpSequence.size() === 0) {
    const padded = new Float32Array(FRAME_SIZE)
    padded.set(audioData.subarray(0, Math.min(audioData.length, FRAME_SIZE)))
    const hpcpVec = extractor.hpcpExtractor(padded, sr, true)
    pcpSequence.push_back(hpcpVec)
  }

  const result = extractor.ChordsDetection(pcpSequence, HOP_SIZE, sr, CHORD_WINDOW_SEC)
  const rawChords = vectorStringToArray(result.chords)
  const barChords = quantizeChordsByBar(rawChords, barDurationSec, barCount, sampleRate)
  return formatBarChords(barChords)
}

function finishInit() {
  try {
    if (!wasmModule) {
      throw new Error('Essentia WASM module failed to load')
    }
    extractor = new EssentiaExtractor(wasmModule)
    self.postMessage({ type: 'ready' })
  } catch (err) {
    console.error('[chordsWorker] init failed', err)
    self.postMessage({ type: 'init-error', message: err instanceof Error ? err.message : String(err) })
  }
}

if (wasmModule.calledRun) {
  finishInit()
} else {
  const previousOnRuntimeInitialized = wasmModule.onRuntimeInitialized
  wasmModule.onRuntimeInitialized = function onRuntimeInitialized() {
    if (typeof previousOnRuntimeInitialized === 'function') previousOnRuntimeInitialized()
    finishInit()
  }
}

self.onmessage = (event) => {
  const { type, requestId, audio, sampleRate, barDurationSec, barCount } = event.data ?? {}
  if (type !== 'detect') return

  try {
    if (!extractor) {
      self.postMessage({ type: 'error', requestId, message: 'Essentia not initialized' })
      return
    }
    const audioData = audio instanceof Float32Array ? audio : new Float32Array(audio)
    const chords = detectChords(
      audioData,
      sampleRate,
      barDurationSec ?? 2,
      barCount ?? 1,
    )
    self.postMessage({ type: 'result', requestId, chords })
  } catch (err) {
    self.postMessage({ type: 'error', requestId, message: err instanceof Error ? err.message : String(err) })
  }
}

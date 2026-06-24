/* eslint-disable no-undef */
/**
 * Essentia.js chord detection worker.
 * Uses essentia-wasm.umd.js (worker-safe). The .web.js build requires `document`.
 * Assets are served locally — CSP blocks CDN importScripts.
 */
const ESSENTIA_BASE = '/vendor/essentia'

// UMD WASM build assigns to `exports`; workers have no CommonJS globals.
const exports = {}

importScripts(
  `${ESSENTIA_BASE}/essentia-wasm.umd.js`,
  `${ESSENTIA_BASE}/essentia.js-extractor.umd.js`,
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
 * Aligns bar boundaries to sample time, not a fixed frame index stride.
 * Returns an array with length exactly equal to barCount.
 */
function quantizeChordsByBar(rawChords, audioSampleCount, barDurationSec, barCount, sampleRate) {
  if (!barCount || barCount <= 0) return []

  const sr = sampleRate || 44100
  const samplesPerBar = barDurationSec * sr
  const barChords = []

  for (let bar = 0; bar < barCount; bar += 1) {
    const barStartSample = bar * samplesPerBar
    const barEndSample = Math.min((bar + 1) * samplesPerBar, audioSampleCount)
    const startFrame = Math.floor(barStartSample / HOP_SIZE)
    const endFrame = Math.min(Math.ceil(barEndSample / HOP_SIZE), rawChords.length)
    const chunk = startFrame < endFrame ? rawChords.slice(startFrame, endFrame) : []
    const mode = modeChord(chunk)
    barChords.push(mode ?? 'N')
  }

  return barChords
}

/**
 * Collapse consecutive identical chords into "Name:duration" tokens.
 * Single occurrences omit ":1" for cleaner output.
 */
function collapseConsecutiveChords(barChords) {
  const result = []
  let i = 0
  while (i < barChords.length) {
    const chord = normalizeChordLabel(barChords[i])
    if (isNoChord(chord)) {
      i += 1
      continue
    }
    let count = 1
    while (i + count < barChords.length && normalizeChordLabel(barChords[i + count]) === chord) {
      count += 1
    }
    if (count === 1) {
      result.push(chord)
    } else {
      result.push(`${chord}:${count}`)
    }
    i += count
  }
  return result.join(' ')
}

function formatBarChords(barChords) {
  return collapseConsecutiveChords(barChords)
}

function detectChords(audioData, sampleRate, barDurationSec, barCount) {
  const audioSampleCount = audioData?.length ?? 0
  if (!extractor || !audioData || audioSampleCount < FRAME_SIZE) {
    return formatBarChords(
      quantizeChordsByBar([], audioSampleCount, barDurationSec, barCount, sampleRate),
    )
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
  const barChords = quantizeChordsByBar(
    rawChords,
    audioSampleCount,
    barDurationSec,
    barCount,
    sampleRate,
  )
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

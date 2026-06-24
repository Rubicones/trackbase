import { normalizeChordsToBarCount } from '@/lib/chords'

export interface ChordDetectionOptions {
  sampleRate: number
  barDurationSec: number
  barCount: number
}

/** Trim audio to at most `barCount` bars so the worker cannot analyze extra timeline. */
export function truncateAudioToBarCount(
  audio: Float32Array,
  barCount: number,
  sampleRate: number,
  barDurationSec: number,
): Float32Array {
  if (barCount <= 0 || barDurationSec <= 0 || sampleRate <= 0) return audio
  const maxSamples = Math.ceil(barCount * barDurationSec * sampleRate)
  if (audio.length <= maxSamples) return audio
  return audio.subarray(0, maxSamples)
}

type WorkerOut =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'result'; requestId: string; chords: string }
  | { type: 'error'; requestId: string; message: string }

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null

function ensureWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Chord detection is only available in the browser')
  }
  if (!worker) {
    worker = new Worker('/workers/chordsWorker.js')
    readyPromise = new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerOut>) => {
        if (event.data.type === 'ready') {
          worker!.removeEventListener('message', onMessage)
          worker!.removeEventListener('error', onError)
          resolve()
        } else if (event.data.type === 'init-error') {
          worker!.removeEventListener('message', onMessage)
          worker!.removeEventListener('error', onError)
          reject(new Error(event.data.message))
        }
      }
      const onError = (event: ErrorEvent) => {
        worker!.removeEventListener('message', onMessage)
        worker!.removeEventListener('error', onError)
        reject(new Error(event.message || 'Chord detection worker failed to load'))
      }
      worker!.addEventListener('message', onMessage)
      worker!.addEventListener('error', onError)
    })
  }
  return worker
}

async function ensureWorkerReady(): Promise<void> {
  ensureWorker()
  await readyPromise
}

export interface ChordDetectionOptions {
  sampleRate: number
  barDurationSec: number
  barCount: number
}

/**
 * Run Essentia ChordsDetection on a mono audio slice via the web worker.
 * Output is bar-quantized: exactly one chord label per bar in the section.
 */
export async function detectChordsInAudio(
  audio: Float32Array,
  options: ChordDetectionOptions,
): Promise<string> {
  const { sampleRate, barDurationSec, barCount } = options
  await ensureWorkerReady()
  const w = worker!
  const requestId = crypto.randomUUID()
  const trimmed = truncateAudioToBarCount(audio, barCount, sampleRate, barDurationSec)
  const payload = trimmed.slice()

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerOut>) => {
      const data = event.data
      if (!data || !('requestId' in data) || data.requestId !== requestId) return
      w.removeEventListener('message', onMessage)
      if (data.type === 'error') reject(new Error(data.message))
      else resolve(normalizeChordsToBarCount(data.chords, barCount))
    }
    w.addEventListener('message', onMessage)
    w.postMessage(
      {
        type: 'detect',
        requestId,
        audio: payload,
        sampleRate,
        barDurationSec,
        barCount,
      },
      [payload.buffer],
    )
  })
}

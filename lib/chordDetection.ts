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
          resolve()
        } else if (event.data.type === 'init-error') {
          worker!.removeEventListener('message', onMessage)
          reject(new Error(event.data.message))
        }
      }
      worker!.addEventListener('message', onMessage)
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
  const payload = audio.slice()

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerOut>) => {
      const data = event.data
      if (!data || !('requestId' in data) || data.requestId !== requestId) return
      w.removeEventListener('message', onMessage)
      if (data.type === 'error') reject(new Error(data.message))
      else resolve(data.chords)
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

/**
 * Node-side loader for the same Essentia.js WASM build the browser chord
 * detection worker uses (public/workers/chordsWorker.js). Essentia.js ships
 * an Emscripten UMD bundle that self-detects Node vs. browser/worker and, in
 * Node, sets `module.exports = Module` synchronously — so unlike the worker
 * (which has to wait on `onRuntimeInitialized`), requiring it here hands
 * back a ready-to-use module immediately. Verified in a standalone Node
 * script before wiring this up.
 *
 * `essentia.js` has no `exports` map restricting subpath imports, so we can
 * require its dist files directly instead of going through `public/vendor`
 * (which exists only so the browser worker can `importScripts` it).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EssentiaWASM = require('essentia.js/dist/essentia-wasm.umd.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EssentiaExtractor = require('essentia.js/dist/essentia.js-extractor.umd.js')

export interface EssentiaExtractorInstance {
  hpcpExtractor(frame: Float32Array, sampleRate: number, asVector: boolean): unknown
  ChordsDetection(pcpSequence: unknown, hopSize: number, sampleRate: number, windowSize: number): {
    chords: { size(): number; get(i: number): string }
  }
  KeyExtractor(audioVector: unknown): { key: string; scale: string; strength: number }
  arrayToVector(arr: Float32Array): unknown
}

export interface EssentiaWasmModule {
  VectorVectorFloat: new () => { push_back(v: unknown): void; size(): number }
}

let extractorSingleton: EssentiaExtractorInstance | null = null

/** Lazily construct the Essentia extractor once per server process (cold start). */
export function getServerEssentiaExtractor(): {
  extractor: EssentiaExtractorInstance
  wasmModule: EssentiaWasmModule
} {
  if (!extractorSingleton) {
    extractorSingleton = new EssentiaExtractor(EssentiaWASM) as EssentiaExtractorInstance
  }
  return { extractor: extractorSingleton, wasmModule: EssentiaWASM as EssentiaWasmModule }
}

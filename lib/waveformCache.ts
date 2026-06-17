/**
 * Module-scope caches shared between the project player and the structure editor.
 * Living at module scope means they survive component unmount/remount for the
 * lifetime of the browser tab.
 */

/** Decoded waveform bar amplitudes per track ID (72 floats, normalised 0–1). */
export const waveformBarsCache = new Map<string, number[]>()

/** Raw audio ArrayBuffer per track ID.
 *  decodeAudioData() detaches the buffer, so callers must .slice(0) before decoding. */
export const audioArrayBufferCache = new Map<string, ArrayBuffer>()

const audioFetchInflight = new Map<string, Promise<ArrayBuffer>>()

/** Fetch track audio once; dedupes concurrent requests for the same track. */
export async function fetchTrackAudioBuffer(trackId: string): Promise<ArrayBuffer | null> {
  const cached = audioArrayBufferCache.get(trackId)
  if (cached) return cached.slice(0)

  let inflight = audioFetchInflight.get(trackId)
  if (!inflight) {
    inflight = fetch(`/api/tracks/${trackId}/stream`)
      .then(res => {
        if (!res.ok) throw new Error(`stream ${res.status}`)
        return res.arrayBuffer()
      })
      .then(ab => {
        audioArrayBufferCache.set(trackId, ab.slice(0))
        return ab
      })
      .finally(() => {
        audioFetchInflight.delete(trackId)
      })
    audioFetchInflight.set(trackId, inflight)
  }

  try {
    const ab = await inflight
    return ab.slice(0)
  } catch {
    return null
  }
}

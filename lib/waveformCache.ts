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

/** Raw audio ArrayBuffer per content key (e.g. file_hash) — shared across track IDs. */
export const audioContentBufferCache = new Map<string, ArrayBuffer>()

const audioFetchInflight = new Map<string, Promise<ArrayBuffer>>()

export type FetchTrackAudioOptions = {
  /** Dedupe fetch/storage across track IDs when bytes are identical (compare mode, branches). */
  contentKey?: string | null
}

function warmTrackAudioCache(trackId: string, ab: ArrayBuffer) {
  if (!audioArrayBufferCache.has(trackId)) {
    audioArrayBufferCache.set(trackId, ab.slice(0))
  }
}

/** Fetch track audio once; dedupes concurrent requests for the same track or content key. */
export async function fetchTrackAudioBuffer(
  trackId: string,
  options?: FetchTrackAudioOptions,
): Promise<ArrayBuffer | null> {
  const contentKey = options?.contentKey ?? null

  if (contentKey) {
    const byContent = audioContentBufferCache.get(contentKey)
    if (byContent) {
      warmTrackAudioCache(trackId, byContent)
      return byContent.slice(0)
    }
  }

  const cached = audioArrayBufferCache.get(trackId)
  if (cached) {
    if (contentKey) audioContentBufferCache.set(contentKey, cached.slice(0))
    return cached.slice(0)
  }

  const inflightKey = contentKey ? `content:${contentKey}` : `track:${trackId}`
  let inflight = audioFetchInflight.get(inflightKey)
  if (!inflight) {
    inflight = fetch(`/api/tracks/${trackId}/stream`)
      .then(res => {
        if (!res.ok) throw new Error(`stream ${res.status}`)
        return res.arrayBuffer()
      })
      .then(ab => {
        const stored = ab.slice(0)
        warmTrackAudioCache(trackId, stored)
        if (contentKey) audioContentBufferCache.set(contentKey, stored.slice(0))
        return stored
      })
      .finally(() => {
        audioFetchInflight.delete(inflightKey)
      })
    audioFetchInflight.set(inflightKey, inflight)
  }

  try {
    const ab = await inflight
    warmTrackAudioCache(trackId, ab)
    return ab.slice(0)
  } catch {
    return null
  }
}

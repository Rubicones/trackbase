/** Client-side preview mix fetch + preload (rehearsal mode, waveforms). */

const previewMixApiUrl = (projectId: string) => `/api/projects/${projectId}/preview-mix`

const bufferCache = new Map<string, ArrayBuffer>()
const bufferInflight = new Map<string, Promise<ArrayBuffer | null>>()
const preloadAudioByProject = new Map<string, HTMLAudioElement>()

/** Warm the preview MP3 via a hidden Audio element (streams like the band page). */
export function prefetchPreviewMixPlayback(projectId: string): void {
  if (!projectId || preloadAudioByProject.has(projectId)) return
  const audio = new Audio()
  audio.preload = 'auto'
  audio.src = previewMixApiUrl(projectId)
  preloadAudioByProject.set(projectId, audio)
}

/** Take a preloaded Audio element for playback, or null if none exists. */
export function takePreloadedPreviewAudio(projectId: string): HTMLAudioElement | null {
  const audio = preloadAudioByProject.get(projectId)
  if (!audio) return null
  preloadAudioByProject.delete(projectId)
  return audio
}

/** Fetch full preview MP3 bytes (deduped; cached for waveform decode). */
export async function fetchPreviewMixBuffer(projectId: string): Promise<ArrayBuffer | null> {
  const cached = bufferCache.get(projectId)
  if (cached) return cached.slice(0)

  let inflight = bufferInflight.get(projectId)
  if (!inflight) {
    inflight = fetch(previewMixApiUrl(projectId))
      .then(res => {
        if (!res.ok) return null
        return res.arrayBuffer()
      })
      .then(ab => {
        if (ab?.byteLength) bufferCache.set(projectId, ab.slice(0))
        return ab
      })
      .finally(() => {
        bufferInflight.delete(projectId)
      })
    bufferInflight.set(projectId, inflight)
  }

  try {
    const ab = await inflight
    return ab?.byteLength ? ab.slice(0) : null
  } catch {
    return null
  }
}

export function previewMixPlaybackUrl(projectId: string): string {
  return previewMixApiUrl(projectId)
}

export function clearPreviewMixClientCache(projectId?: string): void {
  if (projectId) {
    bufferCache.delete(projectId)
    const audio = preloadAudioByProject.get(projectId)
    if (audio) {
      audio.pause()
      audio.src = ''
      preloadAudioByProject.delete(projectId)
    }
    return
  }
  bufferCache.clear()
  preloadAudioByProject.forEach(audio => {
    audio.pause()
    audio.src = ''
  })
  preloadAudioByProject.clear()
}

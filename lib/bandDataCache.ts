/**
 * Shared band payload cache + in-flight dedupe for /api/bands/[id].
 *
 * Band page and ChatDock both need projects/members from this endpoint.
 * Without sharing, a single navigation fires the request twice (×2 again
 * under React Strict Mode in dev).
 */

const BAND_CACHE_TTL_MS = 30_000

type CacheEntry = { data: Record<string, unknown>; cachedAt: number }

const bandDataCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<Record<string, unknown>>>()

export class BandFetchError extends Error {
  status: number
  body: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown> = {}) {
    super(typeof body.error === 'string' ? body.error : `Band fetch failed (${status})`)
    this.name = 'BandFetchError'
    this.status = status
    this.body = body
  }
}

export function getCachedBandData(bandId: string): Record<string, unknown> | null {
  const entry = bandDataCache.get(bandId)
  if (!entry) return null
  if (Date.now() - entry.cachedAt >= BAND_CACHE_TTL_MS) return null
  return entry.data
}

export function setCachedBandData(bandId: string, data: Record<string, unknown>) {
  bandDataCache.set(bandId, { data, cachedAt: Date.now() })
}

export function invalidateBandData(bandId: string) {
  bandDataCache.delete(bandId)
  inflight.delete(bandId)
}

/**
 * Fetch band JSON, reusing TTL cache and coalescing concurrent callers
 * onto one network request. AbortSignal only abandons the waiter — it does
 * not cancel a shared in-flight fetch (so Strict Mode remounts can reuse it).
 */
export async function fetchBandData(
  bandId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const cached = getCachedBandData(bandId)
  if (cached) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return cached
  }

  let promise = inflight.get(bandId)
  if (!promise) {
    promise = fetch(`/api/bands/${bandId}`)
      .then(async res => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
          throw new BandFetchError(res.status, body)
        }
        return (await res.json()) as Record<string, unknown>
      })
      .then(data => {
        setCachedBandData(bandId, data)
        inflight.delete(bandId)
        return data
      })
      .catch(err => {
        inflight.delete(bandId)
        throw err
      })
    inflight.set(bandId, promise)
  }

  const data = await promise
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return data
}

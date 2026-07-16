/**
 * Coalesce concurrent JSON GETs to the same URL onto one network request.
 * Optional short TTL cache for back-nav / Strict Mode remounts.
 */

type CacheEntry = { data: unknown; cachedAt: number }

const inflight = new Map<string, Promise<unknown>>()
const cache = new Map<string, CacheEntry>()

export async function fetchJsonInflight<T>(
  url: string,
  opts?: {
    ttlMs?: number
    signal?: AbortSignal
    init?: RequestInit
  },
): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 0
  if (ttlMs > 0) {
    const hit = cache.get(url)
    if (hit && Date.now() - hit.cachedAt < ttlMs) {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return hit.data as T
    }
  }

  let promise = inflight.get(url) as Promise<T> | undefined
  if (!promise) {
    promise = fetch(url, opts?.init)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const err = new Error(
            typeof (body as { error?: string }).error === 'string'
              ? (body as { error: string }).error
              : `Request failed (${res.status})`,
          ) as Error & { status: number; body: unknown }
          err.status = res.status
          err.body = body
          throw err
        }
        return res.json() as Promise<T>
      })
      .then(data => {
        if (ttlMs > 0) cache.set(url, { data, cachedAt: Date.now() })
        inflight.delete(url)
        return data
      })
      .catch(err => {
        inflight.delete(url)
        throw err
      })
    inflight.set(url, promise)
  }

  const data = await promise
  if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return data
}

export function invalidateInflightCache(urlPrefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(urlPrefix) || key === urlPrefix) cache.delete(key)
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(urlPrefix) || key === urlPrefix) inflight.delete(key)
  }
}

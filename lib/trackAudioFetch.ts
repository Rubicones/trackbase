/**
 * Browser-side loader for a track's stored audio (FLAC/MIDI) — fast, and
 * all-or-nothing: it either resolves with every byte of the object, verified
 * against the length the server reports, or rejects. Callers never see a
 * partial buffer, so a dropped connection can't decode as a truncated track.
 *
 * Path:
 *   1. Ask `/api/tracks/[id]/stream?signed=1` for a presigned R2 URL and read
 *      it directly from Cloudflare (one hop, no function in the middle).
 *   2. If anything about the direct read fails (R2 CORS not configured, URL
 *      expired, …), redo the whole read through `/api/tracks/[id]/stream`,
 *      which streams the same object through the function with Range support.
 *
 * Each read is ranged: the first CHUNK_BYTES tell us the total size
 * (Content-Range), the remainder is fetched as up to PARALLEL ranges at once.
 * A range that breaks mid-body resumes from the last byte received, with
 * backoff, instead of restarting the file.
 */

const CHUNK_BYTES = 8 * 1024 * 1024
const PARALLEL = 4
const MAX_ATTEMPTS = 4

class FetchAbort extends Error {}

/** A status retrying won't fix (expired/forbidden URL, missing object). */
class FatalHttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`) }
}

function isFatalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new FetchAbort('aborted')) }, { once: true })
  })
}

/** Parse `bytes start-end/total`. */
function parseContentRange(h: string | null): { start: number; end: number; total: number } | null {
  const m = h && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(h.trim())
  return m ? { start: +m[1], end: +m[2], total: +m[3] } : null
}

/**
 * Read bytes [start, end] (inclusive) of `url` into `target` at the same
 * offsets. Resumes from the last received byte on a broken body or a failed
 * request; gives up after MAX_ATTEMPTS consecutive failures without progress.
 */
async function readRange(
  url: string,
  target: Uint8Array,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<void> {
  let pos = start
  let failures = 0
  while (pos <= end) {
    const attemptStart = pos
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${pos}-${end}` }, signal })
      if (isFatalStatus(res.status)) throw new FatalHttpError(res.status)
      if (res.status !== 206) throw new Error(`range ${pos}-${end}: HTTP ${res.status}`)
      const cr = parseContentRange(res.headers.get('Content-Range'))
      // Content-Range may be unreadable cross-origin (not exposed); when it is
      // readable it must match exactly what we asked for.
      if (cr && (cr.start !== pos || cr.end !== end)) throw new Error(`range mismatch ${cr.start}-${cr.end}`)
      if (!res.body) throw new Error('no body')
      const reader = res.body.getReader()
      const before = pos
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (pos + value.length > end + 1) throw new Error('range overflow')
          target.set(value, pos)
          pos += value.length
        }
      } finally {
        reader.releaseLock()
      }
      if (pos <= end) throw new Error(`range ${before}-${end} ended early at ${pos}`)
      return
    } catch (err) {
      if (signal?.aborted) throw new FetchAbort('aborted')
      if (err instanceof FatalHttpError) throw err
      // Progress made during this attempt resets the budget — only stalls count.
      failures = pos > attemptStart ? 1 : failures + 1
      if (failures >= MAX_ATTEMPTS) throw err
      await sleep(400 * 2 ** (failures - 1), signal)
    }
  }
}

/** Read an entire object via ranged requests. Rejects unless every byte arrived. */
async function readAll(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  // First chunk: data + the total size.
  let first: Response | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !first; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=0-${CHUNK_BYTES - 1}` }, signal })
      if (res.status === 200 || res.status === 206) first = res
      else if (isFatalStatus(res.status)) throw new FatalHttpError(res.status)
      else lastErr = new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (signal?.aborted) throw new FetchAbort('aborted')
      if (err instanceof FatalHttpError) throw err
      lastErr = err
    }
    if (!first) await sleep(400 * 2 ** attempt, signal)
  }
  if (!first) throw lastErr ?? new Error('fetch failed')

  // Server ignored Range → whole object in one body. Verify against Content-Length.
  if (first.status === 200) {
    const buf = await first.arrayBuffer()
    const declared = Number(first.headers.get('Content-Length') ?? NaN)
    if (Number.isFinite(declared) && declared !== buf.byteLength) {
      throw new Error(`length mismatch ${buf.byteLength}/${declared}`)
    }
    return buf
  }

  const cr = parseContentRange(first.headers.get('Content-Range'))
  if (!cr) {
    // 206 but the total isn't visible to us — don't guess at offsets. Let the
    // caller fall back to the proxy, where Content-Range is same-origin.
    throw new Error('Content-Range not readable')
  }
  if (cr.start !== 0) throw new Error('first range does not start at 0')

  const total = cr.total
  const target = new Uint8Array(total)

  // Copy the first body in, resuming it via readRange if it breaks.
  let pos = 0
  try {
    const reader = first.body!.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (pos + value.length > cr.end + 1) throw new Error('range overflow')
      target.set(value, pos)
      pos += value.length
    }
  } catch {
    if (signal?.aborted) throw new FetchAbort('aborted')
    // fall through: resume the rest of the first range below
  }
  if (pos <= cr.end) await readRange(url, target, pos, cr.end, signal)

  // Remaining ranges, PARALLEL at a time.
  const ranges: [number, number][] = []
  for (let s = cr.end + 1; s < total; s += CHUNK_BYTES) {
    ranges.push([s, Math.min(s + CHUNK_BYTES, total) - 1])
  }
  let next = 0
  const workers = Array.from({ length: Math.min(PARALLEL, ranges.length) }, async () => {
    while (next < ranges.length) {
      const [s, e] = ranges[next++]
      await readRange(url, target, s, e, signal)
    }
  })
  await Promise.all(workers)

  return target.buffer
}

/**
 * Fetch a track's stored file completely. Direct from R2 first, through the
 * app as a fallback. Rejects (never resolves partially) if both fail.
 */
export async function fetchTrackFile(trackId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  try {
    const res = await fetch(`/api/tracks/${trackId}/stream?signed=1`, { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`signed url: HTTP ${res.status}`)
    const { url } = (await res.json()) as { url?: string }
    if (!url) throw new Error('signed url missing')
    return await readAll(url, signal)
  } catch (err) {
    if (signal?.aborted || err instanceof FetchAbort) throw err
    console.warn('[trackAudioFetch] direct R2 read failed, using proxy:', err)
    return await readAll(`/api/tracks/${trackId}/stream`, signal)
  }
}

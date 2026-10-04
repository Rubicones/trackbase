/**
 * Browser uploader for track files → R2 temp key, ready for tracks/process.
 *
 *   const { tempKey, sha256 } = await uploadTrackFile({ versionId, file, filename, onProgress })
 *
 * - Small files (≤ SINGLE_PUT_MAX_BYTES): one presigned PUT, retried.
 * - Larger files: R2 multipart via `tracks/multipart` — parts of `partSize`,
 *   PARALLEL_PARTS at a time, each retried on its own with backoff (a dropped
 *   connection costs one part, not the file), stalled transfers are cut and
 *   retried, expired part URLs are re-signed, and going offline pauses retries
 *   until the browser is back online.
 * - Resume: the upload's identity is kept in localStorage under the file's
 *   fingerprint (version + name + size + lastModified). Picking the same file
 *   again after a reload/crash asks R2 which parts it already has and sends
 *   only the rest.
 * - All-or-nothing: the server only completes the upload after verifying every
 *   part is present at its exact size; until then no object exists.
 * - Integrity: the file's SHA-256 is computed in the background while it
 *   uploads; `process` compares it with what R2 holds and refuses a mismatch.
 *
 * Errors: `TrackUploadError`. `body` carries the server's JSON error (so the
 * caller can run it through its plan-aware message mapping).
 */
import { sha256OfBlob } from '@/lib/sha256'
import { SINGLE_PUT_MAX_BYTES, expectedPartBytes } from '@/lib/multipartSizing'

const PARALLEL_PARTS = 4
/**
 * How long a transfer may keep failing for network reasons before the upload
 * gives up. Long on purpose: a laptop changing networks, a train tunnel or
 * wifi switched off for a few minutes must resume, not fail. Server refusals
 * (4xx) still fail immediately.
 */
const NETWORK_RETRY_WINDOW_MS = 10 * 60 * 1000
const MAX_BACKOFF_MS = 10_000
/** No upload progress for this long = the connection is dead; cut and retry. */
const STALL_MS = 20_000
const RESUME_MAX_AGE_MS = 20 * 60 * 60 * 1000 // under the 1-day R2 lifecycle rule
const SIGN_BATCH = 20

export class TrackUploadError extends Error {
  constructor(message: string, public status = 0, public body: unknown = null) {
    super(message)
    this.name = 'TrackUploadError'
  }
}

export interface TrackUploadResult { tempKey: string; sha256: string }

export interface TrackUploadOptions {
  versionId: string
  file: Blob
  filename: string
  /** Defaults to file.type. */
  contentType?: string
  /** 0–1 fraction of bytes on R2. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// ── small helpers ─────────────────────────────────────────────────────────────

function abortError() {
  return new DOMException('Upload cancelled', 'AbortError')
}

function hasWindow() {
  return typeof window !== 'undefined' && typeof window.addEventListener === 'function'
}

/**
 * Wait `ms`, but wake early when the browser reports it is back online — a
 * retry backoff must not keep the user waiting after the network returns.
 */
function sleepOrOnline(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const cleanup = () => {
      clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
      if (hasWindow()) window.removeEventListener('online', onWake)
    }
    const onWake = () => { cleanup(); resolve() }
    const onAbort = () => { cleanup(); reject(abortError()) }
    const t = setTimeout(onWake, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (hasWindow()) window.addEventListener('online', onWake)
  })
}

/** Resolves when the browser reports being online (immediately if it is). */
function whenOnline(signal?: AbortSignal) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const done = () => { window.removeEventListener('online', done); signal?.removeEventListener('abort', onAbort); resolve() }
    const onAbort = () => { window.removeEventListener('online', done); reject(abortError()) }
    window.addEventListener('online', done)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function isRetryable(err: unknown) {
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof TrackUploadError) {
    // No status = network-level failure. 403 = expired/invalid signature →
    // retryable with a fresh URL.
    return !err.status || err.status >= 500 || err.status === 403 || err.status === 408 || err.status === 429
  }
  return true // fetch() TypeError etc. — network
}

/**
 * Run `fn` until it succeeds. Network-type failures are retried for up to
 * NETWORK_RETRY_WINDOW_MS of *continuous* failure (any success resets it),
 * with capped backoff that is cut short by the browser's `online` event, and
 * paused entirely while the browser says it's offline. `navigator.onLine` is
 * only a hint — it is often wrong (stays true with wifi off) — so the time
 * window, not the flag, is what bounds the retries.
 */
async function withRetries<T>(fn: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let failingSince = 0
  for (let attempt = 0; ; attempt++) {
    await whenOnline(signal)
    try {
      return await fn(attempt)
    } catch (err) {
      if (signal?.aborted) throw abortError()
      if (!isRetryable(err)) throw err
      const now = Date.now()
      failingSince ||= now
      if (now - failingSince > NETWORK_RETRY_WINDOW_MS) throw err
      await sleepOrOnline(Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(attempt, 10)), signal)
    }
  }
}

async function api<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return withRetries(async () => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw abortError()
      throw new TrackUploadError(`Network error — ${(err as Error)?.message ?? 'request failed'}`)
    }
    const json = await res.json().catch(() => ({}))
    if (res.ok) return json as T
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`
    throw new TrackUploadError(msg, res.status, json)
  }, signal)
}

/**
 * PUT `body` to `url` with progress. Rejects on non-2xx, network error, abort,
 * or a stall (no progress for STALL_MS). `status` is set on HTTP failures.
 *
 * Network changes: when the browser fires `offline`, the request is cut at
 * once (its socket is about to die anyway); when it fires `online`, a request
 * that hasn't progressed recently is cut too — after wifi comes back, a PUT
 * that was in flight usually sits on a dead TCP connection that would only be
 * noticed at the stall timeout. Both are retryable errors, so the caller
 * re-sends the part immediately on the new connection.
 */
function xhrPut(
  url: string,
  body: Blob,
  contentType: string | null,
  onLoaded: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    let lastProgressAt = Date.now()
    let settled = false
    const finish = (err?: unknown) => {
      if (settled) return
      settled = true
      if (stallTimer) clearTimeout(stallTimer)
      signal?.removeEventListener('abort', onAbort)
      if (hasWindow()) {
        window.removeEventListener('offline', onOffline)
        window.removeEventListener('online', onOnline)
      }
      if (err) reject(err)
      else resolve()
    }
    const cut = (err: unknown) => { xhr.abort(); finish(err) }
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => cut(new TrackUploadError('Upload stalled')), STALL_MS)
    }
    const onAbort = () => cut(abortError())
    const onOffline = () => cut(new TrackUploadError('Went offline'))
    const onOnline = () => {
      if (Date.now() - lastProgressAt > 2000) cut(new TrackUploadError('Network changed'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (hasWindow()) {
      window.addEventListener('offline', onOffline)
      window.addEventListener('online', onOnline)
    }

    xhr.upload.onprogress = e => { lastProgressAt = Date.now(); armStall(); onLoaded(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish()
      else finish(new TrackUploadError(`Upload failed (HTTP ${xhr.status})`, xhr.status))
    }
    xhr.onerror = () => finish(new TrackUploadError('Network error during upload'))
    xhr.ontimeout = () => finish(new TrackUploadError('Upload timed out'))
    xhr.open('PUT', url)
    if (contentType) xhr.setRequestHeader('Content-Type', contentType)
    armStall()
    xhr.send(body)
  })
}

// ── resume state ──────────────────────────────────────────────────────────────

interface MultipartState {
  tempKey: string
  uploadId: string
  partSize: number
  partCount: number
  createdAt: number
}

function stateKey(versionId: string, file: Blob, filename: string): string | null {
  const lm = (file as File).lastModified
  if (typeof lm !== 'number') return null // Blobs (e.g. fresh recordings) have no stable identity
  return `tb-mpu:v1:${versionId}:${filename}:${file.size}:${lm}`
}

function loadState(key: string | null): MultipartState | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const s = JSON.parse(raw) as MultipartState
    if (Date.now() - s.createdAt > RESUME_MAX_AGE_MS) { localStorage.removeItem(key); return null }
    return s
  } catch { return null }
}

function saveState(key: string | null, s: MultipartState | null) {
  if (!key) return
  try {
    if (s) localStorage.setItem(key, JSON.stringify(s))
    else localStorage.removeItem(key)
  } catch { /* storage unavailable — resume just won't work */ }
}

// ── single PUT ────────────────────────────────────────────────────────────────

async function uploadSingle(o: TrackUploadOptions, contentType: string): Promise<string> {
  const base = `/api/versions/${o.versionId}/tracks`
  let signed = await api<{ presignedUrl: string; tempKey: string; contentType?: string }>(
    `${base}/presign`,
    { filename: o.filename, fileSize: o.file.size, contentType },
    o.signal,
  )
  await withRetries(async attempt => {
    if (attempt > 0) {
      // Fresh URL each retry (covers expiry) — new temp key too; the old one,
      // if partially written, is reclaimed by the temp/ lifecycle rule.
      signed = await api(`${base}/presign`, { filename: o.filename, fileSize: o.file.size, contentType }, o.signal)
    }
    await xhrPut(
      signed.presignedUrl, o.file, signed.contentType ?? contentType,
      loaded => o.onProgress?.(Math.min(1, loaded / o.file.size)), o.signal,
    )
  }, o.signal)
  o.onProgress?.(1)
  return signed.tempKey
}

// ── multipart ─────────────────────────────────────────────────────────────────

async function uploadMultipart(o: TrackUploadOptions, contentType: string): Promise<string> {
  const url = `/api/versions/${o.versionId}/tracks/multipart`
  const { file, signal } = o
  const fp = stateKey(o.versionId, file, o.filename)

  for (let restart = 0; restart < 2; restart++) {
    // ── create or resume ──
    let state = loadState(fp)
    const have = new Set<number>()
    if (state) {
      try {
        const { parts } = await api<{ parts: { partNumber: number; size: number }[] }>(
          url, { action: 'list', tempKey: state.tempKey, uploadId: state.uploadId }, signal,
        )
        for (const p of parts) {
          if (p.size === expectedPartBytes(p.partNumber, file.size, state.partSize)) have.add(p.partNumber)
        }
      } catch (err) {
        if (err instanceof TrackUploadError && err.status === 404) { saveState(fp, null); state = null }
        else throw err
      }
    }
    if (!state) {
      const created = await api<Omit<MultipartState, 'createdAt'>>(
        url, { action: 'create', filename: o.filename, fileSize: file.size, contentType }, signal,
      )
      state = { ...created, createdAt: Date.now() }
      saveState(fp, state)
    }
    const s = state

    // ── progress accounting ──
    let doneBytes = 0
    for (const n of have) doneBytes += expectedPartBytes(n, file.size, s.partSize)
    const inflight = new Map<number, number>()
    const report = () => {
      let live = 0
      for (const v of inflight.values()) live += v
      o.onProgress?.(Math.min(1, (doneBytes + live) / file.size))
    }
    report()

    // ── part URLs, signed in batches, re-signed on demand ──
    const urls = new Map<number, string>()
    const sign = async (nums: number[]) => {
      const { urls: got } = await api<{ urls: Record<string, string> }>(
        url, { action: 'sign', tempKey: s.tempKey, uploadId: s.uploadId, partNumbers: nums }, signal,
      )
      for (const [n, u] of Object.entries(got)) urls.set(Number(n), u)
    }

    const sendParts = async (todo: number[]) => {
      const queue = [...todo]
      // One failing worker stops the others — no part keeps uploading in the
      // background after this call has given up (or been cancelled).
      const stop = new AbortController()
      const onOuterAbort = () => stop.abort()
      signal?.addEventListener('abort', onOuterAbort, { once: true })
      const worker = async () => {
        for (;;) {
          if (stop.signal.aborted) return
          const n = queue.shift()
          if (n === undefined) return
          const start = (n - 1) * s.partSize
          const blob = file.slice(start, start + expectedPartBytes(n, file.size, s.partSize))
          await withRetries(async attempt => {
            if (!urls.has(n) || attempt > 0) {
              // Sign this part plus the next few queued ones in one request.
              await sign([n, ...queue.slice(0, SIGN_BATCH - 1).filter(q => !urls.has(q))])
            }
            inflight.set(n, 0)
            try {
              await xhrPut(urls.get(n)!, blob, null, loaded => { inflight.set(n, loaded); report() }, stop.signal)
            } finally {
              inflight.delete(n)
              report()
            }
          }, stop.signal)
          doneBytes += blob.size
          report()
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, async () => {
          try {
            await worker()
          } catch (err) {
            stop.abort()
            throw err
          }
        }))
      } finally {
        signal?.removeEventListener('abort', onOuterAbort)
      }
    }

    const todo: number[] = []
    for (let n = 1; n <= s.partCount; n++) if (!have.has(n)) todo.push(n)

    try {
      await sendParts(todo)
      // ── complete (server verifies every part; re-send whatever it says is missing) ──
      for (let round = 0; ; round++) {
        try {
          await api(url, { action: 'complete', tempKey: s.tempKey, uploadId: s.uploadId, fileSize: file.size }, signal)
          break
        } catch (err) {
          const missing = (err instanceof TrackUploadError && err.status === 409)
            ? ((err.body as { missingParts?: number[] })?.missingParts ?? [])
            : null
          if (!missing?.length || round >= 2) throw err
          for (const n of missing) doneBytes -= expectedPartBytes(n, file.size, s.partSize)
          urls.clear()
          await sendParts(missing)
        }
      }
      saveState(fp, null)
      o.onProgress?.(1)
      return s.tempKey
    } catch (err) {
      // The upload vanished (expired / aborted elsewhere): start over once.
      if (err instanceof TrackUploadError && err.status === 404 && restart === 0) {
        saveState(fp, null)
        continue
      }
      throw err
    }
  }
  throw new TrackUploadError('Upload could not be completed')
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function uploadTrackFile(o: TrackUploadOptions): Promise<TrackUploadResult> {
  const contentType = o.contentType || o.file.type || 'application/octet-stream'
  // Hash concurrently with the upload; it's much faster than the network.
  const hashStop = new AbortController()
  const onAbort = () => hashStop.abort()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  const hashing = sha256OfBlob(o.file, hashStop.signal)
  hashing.catch(() => {}) // surfaced via the await below
  try {
    const tempKey = o.file.size <= SINGLE_PUT_MAX_BYTES
      ? await uploadSingle(o, contentType)
      : await uploadMultipart(o, contentType)
    return { tempKey, sha256: await hashing }
  } catch (err) {
    hashStop.abort() // don't keep reading the file for an upload that failed
    throw err
  } finally {
    o.signal?.removeEventListener('abort', onAbort)
  }
}

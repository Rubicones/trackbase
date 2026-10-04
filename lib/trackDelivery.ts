/**
 * Server-side delivery of stored track audio — how bytes get from R2 to the
 * browser without passing through (or piling up in) a Vercel function.
 *
 * Two modes, used by `/api/tracks/[id]/stream` and `/api/tracks/[id]/download`:
 *
 * - **Signed (default for new clients):** the route hands out a short-lived
 *   presigned R2 GET URL and the browser fetches from Cloudflare directly —
 *   one hop, Range/resume support, no function time or memory spent per byte.
 *   Needs R2 CORS for `fetch()` readers (see AGENTS.md → Track delivery).
 * - **Proxy (fallback):** `r2ObjectResponse()` streams the object through the
 *   function, passing a single `Range` through to R2. Never buffered, so size
 *   is irrelevant. Clients fall back to it when the direct fetch fails (CORS
 *   misconfigured, URL expired), so delivery never depends on bucket config.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { Readable } from 'stream'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  getR2ObjectStream,
  headR2Object,
  readR2ObjectHead,
  streamR2ObjectToFile,
  uploadStreamToR2,
} from '@/lib/r2'
import { flacFileToWavFile, flacStreamToWav, parseFlacStreamInfo } from '@/lib/ffmpeg'
import { attachmentDisposition } from '@/lib/contentDisposition'

/**
 * Cache key for a track's WAV rendering. Content-addressed by the FLAC's hash
 * plus the start_bar offset baked into the WAV, so an entry can never go
 * stale — a new edit or offset is a new key. `v1` versions the conversion
 * itself (bump it if the WAV format/policy in lib/ffmpeg.ts changes).
 *
 * `cache/` is NOT counted against band storage and is expected to carry an R2
 * lifecycle rule that expires objects (AGENTS.md → Track delivery).
 */
export function wavCacheKey(flacStoragePath: string, delayMs: number): string {
  const base = flacStoragePath.slice(flacStoragePath.lastIndexOf('/') + 1).replace(/\.flac$/, '')
  return `cache/wav/v1/${base}-d${Math.round(delayMs * 1000)}.wav`
}

/**
 * Make sure the WAV rendering of `flacKey` exists at `wavKey`. Streams
 * R2 → ffmpeg → R2 multipart: no /tmp, constant memory, so track length is
 * not bounded by the function. The upload is aborted on any failure, so a
 * partial WAV is never published under `wavKey`.
 */
export async function ensureWavInR2(flacKey: string, wavKey: string, delayMs: number): Promise<void> {
  if (await headR2Object(wavKey)) return

  const info = parseFlacStreamInfo(await readR2ObjectHead(flacKey, 42))
  if (info && info.totalSamples > 0) {
    const { body } = await getR2ObjectStream(flacKey)
    const { stream } = flacStreamToWav(body, info, delayMs)
    await uploadStreamToR2(wavKey, stream, 'audio/wav')
    return
  }

  // No sample count in the header (not something our pipeline writes, but be
  // safe): the file-based conversion lets ffmpeg seek back and fix the header.
  // Bounded by /tmp, which is acceptable for this edge case only.
  const flacPath = join(tmpdir(), `${randomUUID()}.flac`)
  const wavPath = join(tmpdir(), `${randomUUID()}.wav`)
  try {
    await streamR2ObjectToFile(flacKey, flacPath)
    await flacFileToWavFile(flacPath, wavPath, delayMs)
    await unlink(flacPath).catch(() => {})
    await uploadStreamToR2(wavKey, createReadStream(wavPath), 'audio/wav')
  } finally {
    await unlink(flacPath).catch(() => {})
    await unlink(wavPath).catch(() => {})
  }
}

const SINGLE_RANGE = /^bytes=\d*-\d*$/

/**
 * Stream an R2 object through the function (proxy mode). Honours a single
 * `Range` header by passing it to R2, so resumable/parallel range readers
 * work the same against this as against a presigned URL.
 */
export async function r2ObjectResponse(
  req: NextRequest,
  key: string,
  opts: { contentType: string; filename?: string },
): Promise<NextResponse> {
  const rawRange = req.headers.get('range')?.trim()
  const range = rawRange && SINGLE_RANGE.test(rawRange) && rawRange !== 'bytes=-' ? rawRange : undefined

  let obj: Awaited<ReturnType<typeof getR2ObjectStream>>
  try {
    obj = await getR2ObjectStream(key, range)
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === 'InvalidRange' || e?.$metadata?.httpStatusCode === 416) {
      return new NextResponse(null, { status: 416 })
    }
    throw err
  }

  const headers: Record<string, string> = {
    'Content-Type': opts.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  }
  if (obj.contentLength !== undefined) headers['Content-Length'] = String(obj.contentLength)
  if (obj.contentRange) headers['Content-Range'] = obj.contentRange
  if (opts.filename) headers['Content-Disposition'] = attachmentDisposition(opts.filename)

  return new NextResponse(Readable.toWeb(obj.body) as ReadableStream, {
    status: obj.contentRange ? 206 : 200,
    headers,
  })
}

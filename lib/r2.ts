import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} from '@aws-sdk/client-s3'
import type { GetObjectCommandInput } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable, pipeline as streamPipeline } from 'stream'
import { createWriteStream } from 'fs'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { attachmentDisposition } from '@/lib/contentDisposition'

const pipeline = promisify(streamPipeline)

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const BUCKET = process.env.R2_BUCKET_NAME!

export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType = 'audio/flac'
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  )
}

export async function downloadFromR2(key: string): Promise<Buffer> {
  const response = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  )
  const stream = response.Body as Readable
  return streamToBuffer(stream)
}

export async function existsInR2(key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch {
    return false
  }
}

export async function deleteFromR2(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/** Build the canonical R2 storage path for a project file. */
export function r2Key(projectId: string, hash: string): string {
  return `projects/${projectId}/${hash}.flac`
}

/** Build the canonical R2 storage path for a project's MIDI file. */
export function r2MidiKey(projectId: string, hash: string): string {
  return `projects/${projectId}/${hash}.mid`
}

/** A SHA-256 hex digest, which is the only thing that may name an object. */
const SHA256_HEX = /^[a-f0-9]{64}$/

/**
 * Is `key` a well-formed object path inside `projectId`?
 *
 * Object keys arrive from the browser on two paths — the MIDI save flow's
 * `storage_path`, and the `PATCH /api/tracks/[id]` field of the same name — and
 * an unvalidated one is a write primitive over the whole bucket: band
 * membership authorises the *request*, not the *key*, so a member of any band
 * could name `projects/<someone-else's-project>/<their-hash>.flac` and overwrite
 * another band's audio, or point their own row at it to read it back.
 *
 * The shape is fully determined by server-side facts (the project the track
 * belongs to, and the content hash), so validation is exact rather than a
 * sanitising pass: a traversal sequence, an absolute path or a key belonging to
 * another project all simply fail to match. Callers that can rebuild the key
 * themselves should do that instead and never look at the client's value.
 */
export function isValidProjectObjectKey(key: unknown, projectId: string): key is string {
  if (typeof key !== 'string') return false
  const m = /^projects\/([^/]+)\/([^/]+)\.(flac|mid)$/.exec(key)
  if (!m) return false
  return m[1] === projectId && SHA256_HEX.test(m[2])
}

/** True for a SHA-256 hex digest — the only accepted `tracks.file_hash` value. */
export function isValidFileHash(hash: unknown): hash is string {
  return typeof hash === 'string' && SHA256_HEX.test(hash)
}

/**
 * Generate a presigned PUT URL so the browser can upload directly to R2
 * without routing file bytes through the Next.js server.
 *
 * IMPORTANT: R2 bucket must have CORS configured for this to work.
 * In Cloudflare Dashboard → R2 → [bucket] → Settings → CORS, add:
 * [
 *   {
 *     "AllowedOrigins": ["https://sonicdesk.studio", "http://localhost:3000"],
 *     "AllowedMethods": ["PUT", "GET"],
 *     "AllowedHeaders": ["Content-Type", "Range"],
 *     "ExposeHeaders": ["Content-Range", "Content-Length", "ETag"],
 *     "MaxAgeSeconds": 3600
 *   }
 * ]
 * Range/Content-Range are for ranged direct playback reads
 * (lib/trackAudioFetch.ts). ETag is not required: browser multipart uploads
 * are completed server-side from R2's own part listing (tracks/multipart).
 */
/**
 * Generate a presigned GET URL so the browser can download a file directly
 * from R2. Optionally sets Content-Disposition: attachment to trigger a
 * browser Save-As dialog with the original filename.
 */
export async function getPresignedDownloadUrl(
  key: string,
  originalFilename?: string | null,
  expiresIn = 900,
): Promise<string> {
  const input: GetObjectCommandInput = { Bucket: BUCKET, Key: key }
  if (originalFilename) {
    input.ResponseContentDisposition = attachmentDisposition(originalFilename)
  }
  const command = new GetObjectCommand(input)
  return getSignedUrl(client, command, { expiresIn })
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(client, command, { expiresIn })
}

/**
 * Stream a R2 object directly to a local file path.
 * Use this for large files to avoid loading the whole file into memory.
 */
export async function streamR2ObjectToFile(key: string, destPath: string): Promise<void> {
  const response = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  const stream = response.Body as Readable
  await pipeline(stream, createWriteStream(destPath))
}

/**
 * Size of an object, or null when it does not exist. Any other failure
 * (network, auth) throws — "unknown" must never read as "absent" for callers
 * that gate on size.
 */
export async function headR2Object(key: string): Promise<{ size: number } | null> {
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return { size: res.ContentLength ?? 0 }
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
      return null
    }
    throw err
  }
}

/** First `length` bytes of an object (e.g. a FLAC's STREAMINFO header). */
export async function readR2ObjectHead(key: string, length: number): Promise<Buffer> {
  const res = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=0-${length - 1}` }),
  )
  return streamToBuffer(res.Body as Readable)
}

/**
 * Open an object as a stream, optionally for a single byte range
 * (`bytes=start-end`, `bytes=start-`). Nothing is buffered.
 */
export async function getR2ObjectStream(key: string, range?: string): Promise<{
  body: Readable
  contentLength: number | undefined
  contentRange: string | undefined
}> {
  const res = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, ...(range ? { Range: range } : {}) }),
  )
  return {
    body: res.Body as Readable,
    contentLength: res.ContentLength,
    contentRange: res.ContentRange,
  }
}

/**
 * Open several objects as streams at once. All-or-nothing: if any open fails,
 * the ones that did open are destroyed (no leaked sockets) and the error is
 * rethrown.
 */
export async function openR2Streams(keys: string[]): Promise<Readable[]> {
  const opened = await Promise.allSettled(keys.map(k => getR2ObjectStream(k)))
  const failed = opened.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    for (const r of opened) if (r.status === 'fulfilled') r.value.body.destroy()
    throw failed.reason
  }
  return opened.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof getR2ObjectStream>>>).value.body)
}

/** Part size for server-side multipart uploads. R2 requires every part but the last to be the same size. */
const MULTIPART_PART_SIZE = 16 * 1024 * 1024
const MULTIPART_CONCURRENCY = 4

/**
 * Upload a stream of unknown length to R2 without buffering it whole.
 *
 * Small sources (< one part) go up as a single PutObject. Larger ones use a
 * multipart upload with fixed-size parts, at most MULTIPART_CONCURRENCY in
 * flight (≈64 MB of memory). The object only becomes visible when
 * CompleteMultipartUpload succeeds — any failure (including the source
 * throwing) aborts the upload, so a reader can never see a half-written
 * object under `key`.
 *
 * `finalizeHead`: for formats whose header can only be known once the whole
 * stream has been produced (a FLAC written to a pipe has no sample count in
 * STREAMINFO). The first part is held back in memory instead of uploaded;
 * after the source ends it is passed to `finalizeHead`, which may patch it in
 * place (same length) or throw to abort, and only then uploaded.
 */
export async function uploadStreamToR2(
  key: string,
  source: AsyncIterable<Uint8Array>,
  contentType: string,
  opts: { finalizeHead?: (head: Buffer) => void } = {},
): Promise<{ bytes: number }> {
  let uploadId: string | null = null
  const parts: { PartNumber: number; ETag: string }[] = []
  const inflight = new Set<Promise<void>>()
  let failure: unknown = null
  let nextPartNumber = 1
  let total = 0
  /** Part 1, held back until the end when `finalizeHead` is set. */
  let heldHead: Buffer | null = null

  let buf = Buffer.allocUnsafe(MULTIPART_PART_SIZE)
  let fill = 0

  async function ensureUpload(): Promise<string> {
    if (uploadId) return uploadId
    const res = await client.send(
      new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    )
    if (!res.UploadId) throw new Error('R2 did not return an UploadId')
    uploadId = res.UploadId
    return uploadId
  }

  async function sendPart(n: number, body: Buffer): Promise<void> {
    const id = await ensureUpload()
    const p = client
      .send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: id, PartNumber: n, Body: body }))
      .then(res => {
        if (!res.ETag) throw new Error(`R2 part ${n} returned no ETag`)
        parts.push({ PartNumber: n, ETag: res.ETag })
      })
      .catch(err => { failure ??= err })
      .finally(() => { inflight.delete(p) })
    inflight.add(p)
    while (inflight.size >= MULTIPART_CONCURRENCY) await Promise.race(inflight)
    if (failure) throw failure
  }

  async function completePart(body: Buffer): Promise<void> {
    const n = nextPartNumber++
    if (n === 1 && opts.finalizeHead) {
      heldHead = body
      return
    }
    await sendPart(n, body)
  }

  try {
    for await (const chunk of source) {
      let off = 0
      while (off < chunk.length) {
        const n = Math.min(chunk.length - off, MULTIPART_PART_SIZE - fill)
        buf.set(chunk.subarray(off, off + n), fill)
        fill += n
        off += n
        total += n
        if (fill === MULTIPART_PART_SIZE) {
          await completePart(buf)
          buf = Buffer.allocUnsafe(MULTIPART_PART_SIZE)
          fill = 0
        }
      }
    }

    if (nextPartNumber === 1) {
      // Whole source fit in one part — a plain PUT is simpler and atomic too.
      const body = buf.subarray(0, fill)
      opts.finalizeHead?.(body)
      await client.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
      }))
      return { bytes: total }
    }

    if (fill > 0) await completePart(buf.subarray(0, fill))
    if (heldHead) {
      opts.finalizeHead!(heldHead)
      await sendPart(1, heldHead)
    }
    await Promise.all(inflight)
    if (failure) throw failure

    parts.sort((a, b) => a.PartNumber - b.PartNumber)
    const expected = nextPartNumber - 1
    if (parts.length !== expected || parts.some((p, i) => p.PartNumber !== i + 1)) {
      throw new Error('Multipart upload lost a part')
    }
    await client.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET, Key: key, UploadId: uploadId!, MultipartUpload: { Parts: parts },
    }))
    return { bytes: total }
  } catch (err) {
    await Promise.allSettled(inflight)
    if (uploadId) {
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
        .catch(() => { /* lifecycle rule reclaims it */ })
    }
    throw err
  }
}

// ── Browser multipart uploads (tracks/multipart) ─────────────────────────────

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const res = await client.send(
    new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
  )
  if (!res.UploadId) throw new Error('R2 did not return an UploadId')
  return res.UploadId
}

/** Presigned PUT for one part. Nothing but the host is signed, so the browser sends the bytes as-is. */
export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    client,
    new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn },
  )
}

export interface UploadedPart { PartNumber: number; ETag: string; Size: number }

/**
 * Every part R2 has received for an upload (paginated), or null if the upload
 * doesn't exist (completed, aborted, or expired by the lifecycle rule).
 */
export async function listUploadedParts(key: string, uploadId: string): Promise<UploadedPart[] | null> {
  const parts: UploadedPart[] = []
  let marker: string | undefined
  try {
    for (;;) {
      const res = await client.send(new ListPartsCommand({
        Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000,
      }))
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag) parts.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 })
      }
      if (!res.IsTruncated) break
      marker = res.NextPartNumberMarker
      if (!marker) break
    }
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    if (e?.name === 'NoSuchUpload' || e?.$metadata?.httpStatusCode === 404) return null
    throw err
  }
  return parts.sort((a, b) => a.PartNumber - b.PartNumber)
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
  }))
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  await client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId }))
}

/** Stream an object into a hash (or any sink) without storing it. Returns the byte count. */
export async function sha256OfR2Object(key: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256')
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  let bytes = 0
  for await (const chunk of res.Body as Readable) {
    hash.update(chunk as Buffer)
    bytes += (chunk as Buffer).length
  }
  return { sha256: hash.digest('hex'), bytes }
}

// ---- helpers ---------------------------------------------------------------

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

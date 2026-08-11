import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import type { GetObjectCommandInput } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable, pipeline as streamPipeline } from 'stream'
import { createWriteStream } from 'fs'
import { promisify } from 'util'

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
 *     "AllowedHeaders": ["Content-Type"],
 *     "MaxAgeSeconds": 3600
 *   }
 * ]
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
    const safe = encodeURIComponent(originalFilename)
    input.ResponseContentDisposition = `attachment; filename="${safe}"; filename*=UTF-8''${safe}`
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

// ---- helpers ---------------------------------------------------------------

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

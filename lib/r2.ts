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

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { Readable } from 'stream'

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

// ---- helpers ---------------------------------------------------------------

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

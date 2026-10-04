/**
 * Multipart part sizing — pure, browser-safe, shared by the server
 * (`tracks/multipart`) and the client uploader (`lib/trackUpload.ts`).
 */

/** Files up to this size go up as one PUT; larger ones as parts. */
export const SINGLE_PUT_MAX_BYTES = 16 * 1024 * 1024

const MIN_PART_BYTES = 16 * 1024 * 1024
const MAX_PARTS = 10_000

/**
 * Part size for a multipart upload of `fileSize` bytes. R2 requires every part
 * except the last to be the same size (≥5 MiB) and allows 10,000 parts. The
 * server decides it and the client uses what it is told; `complete` recomputes
 * it from the declared size to verify the parts.
 */
export function multipartPartSize(fileSize: number): number {
  const mib = 1024 * 1024
  return Math.max(MIN_PART_BYTES, Math.ceil(fileSize / MAX_PARTS / mib) * mib)
}

export function multipartPartCount(fileSize: number, partSize = multipartPartSize(fileSize)): number {
  return Math.ceil(fileSize / partSize)
}

/** Expected byte size of part `n` (1-based). */
export function expectedPartBytes(n: number, fileSize: number, partSize: number): number {
  const count = multipartPartCount(fileSize, partSize)
  return n < count ? partSize : fileSize - (count - 1) * partSize
}

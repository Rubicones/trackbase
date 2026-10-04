/**
 * Validation shared by the two ways a track file reaches R2 —
 * `tracks/presign` (single PUT, small files) and `tracks/multipart`
 * (parallel parts, large files). Both must accept and refuse exactly the same
 * things, so the rules live here, not in either route.
 */
import { randomUUID } from 'crypto'
import { MAX_TRACK_UPLOAD_BYTES, MAX_MIDI_UPLOAD_BYTES, tooLargeMessage } from '@/lib/uploadLimits'

export const ALLOWED_TRACK_MIMETYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/midi',
  'audio/x-midi',
  'audio/mid',
  'application/x-midi',
  // Browsers often report empty string for .mid files
  'application/octet-stream',
])

export function inferTrackContentType(filename: string, provided: string): string {
  if (provided && provided !== 'application/octet-stream') return provided
  if (filename.endsWith('.mid') || filename.endsWith('.midi')) return 'audio/midi'
  if (filename.endsWith('.wav')) return 'audio/wav'
  if (filename.endsWith('.mp3')) return 'audio/mpeg'
  return provided || 'application/octet-stream'
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

/** A fresh temp key in the exact shape `lib/r2TempKey.ts` accepts. */
export function newTrackTempKey(filename: string): string {
  // TODO: A cleanup job should periodically delete objects under temp/ older
  // than 24 hours — covered by the R2 lifecycle rule (AGENTS.md → Track delivery).
  return `temp/${randomUUID()}-${sanitizeFilename(filename)}`
}

/**
 * Check what the browser declares about a file before it may upload it.
 * Declared values only — `process` re-checks the real object.
 */
export function validateDeclaredTrackUpload(body: {
  filename?: unknown
  fileSize?: unknown
  contentType?: unknown
}): { ok: true; filename: string; fileSize: number; contentType: string } | { ok: false; error: string; status: number } {
  const { filename, fileSize, contentType: raw } = body
  if (!filename || typeof filename !== 'string') {
    return { ok: false, error: 'filename is required', status: 400 }
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, error: 'fileSize must be a positive number', status: 400 }
  }
  if (fileSize > MAX_TRACK_UPLOAD_BYTES) {
    return { ok: false, error: tooLargeMessage(), status: 413 }
  }
  const contentType = inferTrackContentType(filename, typeof raw === 'string' ? raw : '')
  if (contentType.includes('midi') && fileSize > MAX_MIDI_UPLOAD_BYTES) {
    return { ok: false, error: tooLargeMessage(MAX_MIDI_UPLOAD_BYTES), status: 413 }
  }
  if (!ALLOWED_TRACK_MIMETYPES.has(contentType)) {
    return {
      ok: false,
      error: `Unsupported file type: "${contentType}". Allowed: WAV, MP3, MIDI.`,
      status: 400,
    }
  }
  return { ok: true, filename, fileSize, contentType }
}

// Multipart sizing lives in lib/multipartSizing.ts (browser-safe, shared with the client).
export { SINGLE_PUT_MAX_BYTES, multipartPartSize, multipartPartCount, expectedPartBytes } from '@/lib/multipartSizing'

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPresignedUploadUrl } from '@/lib/r2'
import { checkBandStorageQuota, storageQuotaError } from '@/lib/bandStorage'

const MAX_FILE_SIZE = 200 * 1024 * 1024

const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/flac',
  'audio/midi', 'audio/x-midi',
  'application/x-als',
  'application/x-logic',
])

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.zip', '.wav', '.mp3', '.flac', '.mid', '.midi',
  '.als', '.logicx', '.ptx', '.rpp', '.flp',
])

const EXT_TYPE_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.als': 'application/octet-stream',
  '.logicx': 'application/octet-stream',
  '.ptx': 'application/octet-stream',
  '.rpp': 'application/octet-stream',
  '.flp': 'application/octet-stream',
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

function inferContentType(filename: string, provided: string): string {
  if (provided && provided !== 'application/octet-stream') return provided
  const ext = filename.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  if (ext && EXT_TYPE_MAP[ext]) return EXT_TYPE_MAP[ext]
  return provided || 'application/octet-stream'
}

function isAllowedUpload(filename: string, contentType: string): boolean {
  if (ALLOWED_MIMETYPES.has(contentType)) return true
  const ext = filename.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  return ext ? ALLOWED_EXTENSIONS.has(ext) : false
}

export type PresignResult =
  | { ok: true; presignedUrl: string; tempKey: string }
  | { ok: false; error: string; status: number; code?: string }

export async function presignResourceUpload(
  supabase: SupabaseClient,
  bandId: string,
  filename: string,
  fileSize: number,
  rawContentType?: string,
): Promise<PresignResult> {
  if (!filename || typeof filename !== 'string') {
    return { ok: false, error: 'filename is required', status: 400 }
  }
  if (typeof fileSize !== 'number' || fileSize <= 0) {
    return { ok: false, error: 'fileSize must be a positive number', status: 400 }
  }
  if (fileSize > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      status: 413,
    }
  }

  const quota = await checkBandStorageQuota(supabase, bandId, fileSize)
  if (!quota.ok) {
    return {
      ok: false,
      error: storageQuotaError(quota.used, quota.limit),
      status: 413,
      code: 'STORAGE_LIMIT',
    }
  }

  const contentType = inferContentType(filename, rawContentType ?? '')
  if (!isAllowedUpload(filename, contentType)) {
    return { ok: false, error: `Unsupported file type: "${contentType}".`, status: 400 }
  }

  const tempKey = `temp/resources/${randomUUID()}-${sanitizeFilename(filename)}`

  try {
    const presignedUrl = await getPresignedUploadUrl(tempKey, contentType)
    return { ok: true, presignedUrl, tempKey }
  } catch (err) {
    console.error('[resource-presign] R2 presign failed:', err)
    return { ok: false, error: 'Failed to generate upload URL', status: 500 }
  }
}

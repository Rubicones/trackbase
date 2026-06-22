import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabase } from '@/lib/supabase'
import { getPresignedUploadUrl } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { checkBandStorageQuota, storageQuotaError } from '@/lib/bandStorage'

// ── File size + type limits ────────────────────────────────────────────────────

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

const ALLOWED_MIMETYPES = new Set([
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

function inferContentType(filename: string, provided: string): string {
  if (provided && provided !== 'application/octet-stream') return provided
  if (filename.endsWith('.mid') || filename.endsWith('.midi')) return 'audio/midi'
  if (filename.endsWith('.wav')) return 'audio/wav'
  if (filename.endsWith('.mp3')) return 'audio/mpeg'
  return provided || 'application/octet-stream'
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: versionId } = await params

  // Verify version exists and enforce band membership
  const access = await requireBandMemberForVersion(req, versionId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  // Parse body
  let body: { filename?: string; fileSize?: number; contentType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { filename, fileSize, contentType: rawContentType } = body

  if (!filename || typeof filename !== 'string') {
    return NextResponse.json({ error: 'filename is required' }, { status: 400 })
  }
  if (typeof fileSize !== 'number' || fileSize <= 0) {
    return NextResponse.json({ error: 'fileSize must be a positive number' }, { status: 400 })
  }
  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
      { status: 413 },
    )
  }

  const quota = await checkBandStorageQuota(supabase, access.project.band_id, fileSize)
  if (!quota.ok) {
    return NextResponse.json(
      { error: storageQuotaError(quota.used, quota.limit), code: 'STORAGE_LIMIT' },
      { status: 413 },
    )
  }

  const contentType = inferContentType(filename, rawContentType ?? '')

  if (!ALLOWED_MIMETYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type: "${contentType}". Allowed: WAV, MP3, MIDI.` },
      { status: 400 },
    )
  }

  // Generate a temporary R2 key for the raw upload.
  // TODO: A cleanup job should periodically delete objects under temp/ older
  // than 24 hours to reclaim storage for abandoned uploads (e.g. browser closed
  // mid-upload). A Cloudflare Worker cron or scheduled Next.js API route works.
  const tempKey = `temp/${randomUUID()}-${sanitizeFilename(filename)}`

  let presignedUrl: string
  try {
    presignedUrl = await getPresignedUploadUrl(tempKey, contentType)
  } catch (err) {
    console.error('[presign] failed to generate presigned URL:', err)
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }

  return NextResponse.json({ presignedUrl, tempKey })
}

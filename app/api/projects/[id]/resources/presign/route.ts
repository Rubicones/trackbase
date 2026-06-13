import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabase } from '@/lib/supabase'
import { getPresignedUploadUrl } from '@/lib/r2'
import { getUserIdFromToken } from '@/lib/supabase/server'

// ── Limits ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

// Allowed MIME types for resource file attachments
const ALLOWED_MIMETYPES = new Set([
  // Documents
  'application/pdf',
  // DAW project files / archives
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  // Audio
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/flac',
  'audio/midi', 'audio/x-midi',
  // Common DAW project extensions sent as generic types
  'application/x-als',   // Ableton
  'application/x-logic', // Logic Pro
])

// Extensions to infer content type when browser reports generic types
const EXT_TYPE_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.als': 'application/octet-stream', // Ableton Live Set
  '.logicx': 'application/octet-stream', // Logic Pro X
  '.ptx': 'application/octet-stream',  // Pro Tools
  '.rpp': 'application/octet-stream',  // REAPER
  '.flp': 'application/octet-stream',  // FL Studio
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

// ── POST /api/projects/[id]/resources/presign ─────────────────────────────────
// Body: { filename: string, fileSize: number, contentType?: string }
// Returns: { presignedUrl, tempKey }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify project membership
  const { data: project } = await supabase
    .from('projects')
    .select('id, band_id')
    .eq('id', projectId)
    .single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const { data: member } = await supabase
    .from('band_members')
    .select('id')
    .eq('band_id', project.band_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!member) {
    return NextResponse.json({ error: 'Not a member of this band' }, { status: 403 })
  }

  let body: { filename?: string; fileSize?: number; contentType?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
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

  const contentType = inferContentType(filename, rawContentType ?? '')

  if (!ALLOWED_MIMETYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Unsupported file type: "${contentType}".` },
      { status: 400 },
    )
  }

  const tempKey = `temp/resources/${randomUUID()}-${sanitizeFilename(filename)}`

  let presignedUrl: string
  try {
    presignedUrl = await getPresignedUploadUrl(tempKey, contentType)
  } catch (err) {
    console.error('[resources/presign] failed:', err)
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }

  return NextResponse.json({ presignedUrl, tempKey })
}

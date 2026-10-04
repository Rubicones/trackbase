import { NextRequest, NextResponse } from 'next/server'
import { getPresignedUploadUrl } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { storageRefusal } from '@/lib/planGuards'
import { newTrackTempKey, validateDeclaredTrackUpload } from '@/lib/trackUploadPolicy'

// Validation: lib/trackUploadPolicy.ts (shared with tracks/multipart). It
// checks DECLARED values only — the process route re-checks what R2 received.

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
  let body: { filename?: unknown; fileSize?: unknown; contentType?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const v = validateDeclaredTrackUpload(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })
  const { filename, fileSize, contentType } = v

  // Per-band storage ceiling, resolved from the band owner's plan plus
  // this band's extra_storage addons. Never pooled across bands.
  const overQuota = await storageRefusal(access.project.band_id, fileSize)
  if (overQuota) return overQuota

  const tempKey = newTrackTempKey(filename)

  let presignedUrl: string
  try {
    presignedUrl = await getPresignedUploadUrl(tempKey, contentType)
  } catch (err) {
    console.error('[presign] failed to generate presigned URL:', err)
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }

  // contentType is signed into the URL — the PUT must send exactly this value.
  return NextResponse.json({ presignedUrl, tempKey, contentType })
}

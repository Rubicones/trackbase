import { NextRequest, NextResponse } from 'next/server'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { storageRefusal } from '@/lib/planGuards'
import { isValidTempKey } from '@/lib/r2TempKey'
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  listUploadedParts,
  presignUploadPart,
} from '@/lib/r2'
import {
  expectedPartBytes,
  multipartPartCount,
  multipartPartSize,
  newTrackTempKey,
  validateDeclaredTrackUpload,
} from '@/lib/trackUploadPolicy'
import { MAX_TRACK_UPLOAD_BYTES } from '@/lib/uploadLimits'

/** Max part URLs signed per request. */
const MAX_SIGN_BATCH = 100
/** Lifetime of a part URL. A part that outlives it is simply re-signed. */
const PART_URL_TTL_SEC = 3600

// POST /api/versions/[id]/tracks/multipart
//
// Browser multipart upload of a track file into R2 at a temp key — the
// large-file sibling of tracks/presign (lib/trackUpload.ts is the client).
// Afterwards the client calls tracks/process with the tempKey, exactly as for
// a single PUT. One route, `action` selects:
//
//   create   { filename, fileSize, contentType } → { tempKey, uploadId, partSize, partCount }
//   sign     { tempKey, uploadId, partNumbers[] } → { urls: { [n]: url } }
//   list     { tempKey, uploadId }                → { parts: [{ partNumber, size }] } | 404
//   complete { tempKey, uploadId, fileSize }      → { ok } | 409 { missingParts }
//   abort    { tempKey, uploadId }                → { ok }
//
// `complete` doesn't trust the client's part list: it lists what R2 actually
// holds and verifies every part 1..N is present at its exact expected size
// before completing — a missing or short part is reported back (409) for the
// client to re-send, never stitched into the object. Because the ETags come
// from R2's listing, the browser never needs to read the ETag header.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: versionId } = await params
  const access = await requireBandMemberForVersion(req, versionId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    if (body.action === 'create') {
      const v = validateDeclaredTrackUpload(body)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })
      const overQuota = await storageRefusal(access.project.band_id, v.fileSize)
      if (overQuota) return overQuota

      const tempKey = newTrackTempKey(v.filename)
      const uploadId = await createMultipartUpload(tempKey, v.contentType)
      const partSize = multipartPartSize(v.fileSize)
      return NextResponse.json({
        tempKey,
        uploadId,
        partSize,
        partCount: multipartPartCount(v.fileSize, partSize),
      })
    }

    // Every other action addresses an existing upload.
    const { tempKey, uploadId } = body
    if (!isValidTempKey(tempKey, 'track')) {
      return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 })
    }
    if (typeof uploadId !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(uploadId)) {
      return NextResponse.json({ error: 'Invalid upload id' }, { status: 400 })
    }

    if (body.action === 'sign') {
      const nums = body.partNumbers
      if (
        !Array.isArray(nums) || nums.length === 0 || nums.length > MAX_SIGN_BATCH ||
        !nums.every(n => Number.isInteger(n) && n >= 1 && n <= 10_000)
      ) {
        return NextResponse.json({ error: 'Invalid partNumbers' }, { status: 400 })
      }
      const entries = await Promise.all(
        (nums as number[]).map(async n => [n, await presignUploadPart(tempKey, uploadId, n, PART_URL_TTL_SEC)] as const),
      )
      return NextResponse.json({ urls: Object.fromEntries(entries) })
    }

    if (body.action === 'list') {
      const parts = await listUploadedParts(tempKey, uploadId)
      if (!parts) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
      return NextResponse.json({ parts: parts.map(p => ({ partNumber: p.PartNumber, size: p.Size })) })
    }

    if (body.action === 'complete') {
      const fileSize = body.fileSize
      if (typeof fileSize !== 'number' || !Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_TRACK_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Invalid fileSize' }, { status: 400 })
      }
      const parts = await listUploadedParts(tempKey, uploadId)
      if (!parts) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

      const partSize = multipartPartSize(fileSize)
      const count = multipartPartCount(fileSize, partSize)
      const byNumber = new Map(parts.map(p => [p.PartNumber, p]))
      const missingParts: number[] = []
      for (let n = 1; n <= count; n++) {
        const p = byNumber.get(n)
        if (!p || p.Size !== expectedPartBytes(n, fileSize, partSize)) missingParts.push(n)
      }
      if (missingParts.length) {
        return NextResponse.json(
          { error: 'Some parts are missing or incomplete', missingParts },
          { status: 409 },
        )
      }
      await completeMultipartUpload(
        tempKey,
        uploadId,
        Array.from({ length: count }, (_, i) => byNumber.get(i + 1)!),
      )
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'abort') {
      await abortMultipartUpload(tempKey, uploadId).catch(() => { /* already gone */ })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error(`[tracks/multipart] ${String(body.action)} failed:`, err)
    return NextResponse.json({ error: 'Upload service error' }, { status: 502 })
  }
}

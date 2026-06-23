import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity, fmtFileSize } from '@/lib/activity'
import { enrichResources, validateResourceContext } from '@/lib/resource-context'
import { deleteFromR2, uploadToR2 } from '@/lib/r2'
import { getRequestUserId } from '@/lib/supabase/server'
import { checkBandStorageQuota, storageQuotaError } from '@/lib/bandStorage'
import { isValidTempKey, uuidFromTempKey } from '@/lib/r2TempKey'

// ── POST /api/projects/[id]/resources/process ─────────────────────────────────
// Called after the browser has finished uploading to R2 via presigned URL.
// Moves the temp object to its final key and inserts a project_resources row.
//
// Body: {
//   tempKey: string         – R2 temp key returned by /presign
//   originalFilename: string
//   fileSize: number
//   mimetype: string
//   title?: string          – optional display name
// }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const userId = await getRequestUserId(req)
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

  let body: {
    tempKey?: string
    originalFilename?: string
    fileSize?: number
    mimetype?: string
    title?: string
    context_version_id?: string | null
    context_track_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    tempKey,
    originalFilename,
    fileSize,
    mimetype = 'application/octet-stream',
    title,
    context_version_id,
    context_track_id,
  } = body

  if (!tempKey || typeof tempKey !== 'string') {
    return NextResponse.json({ error: 'tempKey is required' }, { status: 400 })
  }
  if (!isValidTempKey(tempKey, 'resource')) {
    return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 })
  }
  if (!originalFilename || typeof originalFilename !== 'string') {
    return NextResponse.json({ error: 'originalFilename is required' }, { status: 400 })
  }
  if (typeof fileSize !== 'number' || fileSize <= 0) {
    return NextResponse.json({ error: 'fileSize must be a positive number' }, { status: 400 })
  }

  const ctx = await validateResourceContext(
    supabase,
    projectId,
    context_version_id,
    context_track_id,
  )
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: 400 })
  }

  const quota = await checkBandStorageQuota(supabase, project.band_id, fileSize)
  if (!quota.ok) {
    return NextResponse.json(
      { error: storageQuotaError(quota.used, quota.limit), code: 'STORAGE_LIMIT' },
      { status: 413 },
    )
  }

  // Build final storage key: resources/{projectId}/{uuid}-{filename}
  // UUID comes only from a validated temp key (never from arbitrary client input).
  const uuid = uuidFromTempKey(tempKey, 'resource')
  if (!uuid) {
    return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 })
  }
  const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const finalKey = `resources/${projectId}/${uuid}-${sanitizedFilename}`

  // Copy from temp key to final key by downloading and re-uploading.
  // R2 doesn't support server-side copy via S3 SDK at this tier, so we stream.
  // For large files this is unnecessary bandwidth — but resource files are
  // typically PDFs / project files, not 200 MB audio. This keeps the code simple.
  // If this becomes a bottleneck, switch to a Cloudflare Worker copy.
  let fileBuffer: Buffer
  try {
    const { downloadFromR2 } = await import('@/lib/r2')
    fileBuffer = await downloadFromR2(tempKey)
  } catch (err) {
    console.error('[resources/process] R2 download failed:', err)
    return NextResponse.json({ error: 'Failed to retrieve uploaded file' }, { status: 502 })
  }

  try {
    await uploadToR2(finalKey, fileBuffer, mimetype)
  } catch (err) {
    console.error('[resources/process] R2 upload to final key failed:', err)
    return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
  }

  // Clean up temp object (fire-and-forget)
  deleteFromR2(tempKey).catch(err =>
    console.warn('[resources/process] temp cleanup failed:', err),
  )

  // Compute position (append at end of file resources)
  const { count } = await supabase
    .from('project_resources')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('type', 'file')

  const { data: resource, error: insertErr } = await supabase
    .from('project_resources')
    .insert({
      project_id: projectId,
      type: 'file',
      storage_path: finalKey,
      original_filename: originalFilename,
      file_size_bytes: fileSize,
      mime_type: mimetype,
      title: title?.trim() || null,
      created_by: userId,
      position: count ?? 0,
      context_version_id: ctx.context_version_id,
      context_track_id: ctx.context_track_id,
    })
    .select()
    .single()

  if (insertErr) {
    console.error('[resources/process] DB insert failed:', insertErr)
    return NextResponse.json({ error: 'Failed to save resource record' }, { status: 500 })
  }

  void logActivity({
    bandId: project.band_id,
    userId,
    action: 'resource',
    subject: title?.trim() || originalFilename,
    detail: fmtFileSize(fileSize),
    projectId,
  })

  return NextResponse.json({ resource: (await enrichResources(supabase, [resource]))[0] }, { status: 201 })
}

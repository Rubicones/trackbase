import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
import { enrichResources, validateResourceContext } from '@/lib/resource-context'
import { presignResourceUpload } from '@/lib/resource-presign'
import { requireBandMember } from '@/lib/supabase/server'

// ── GET /api/projects/[id]/resources ──────────────────────────────────────────
// Returns all resources for a project, ordered by position asc, created_at asc.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { project } = access

  const { data: resources, error } = await supabase
    .from('project_resources')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[resources GET] DB error:', error)
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 })
  }

  // Attach author usernames
  const userIds = [...new Set((resources ?? []).map(r => r.created_by).filter(Boolean))]
  let usernameMap: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds)
    if (profiles) {
      usernameMap = Object.fromEntries(profiles.map(p => [p.id, p.username]))
    }
  }

  const enriched = (resources ?? []).map(r => ({
    ...r,
    author_username: r.created_by ? (usernameMap[r.created_by] ?? null) : null,
  }))

  const withContext = await enrichResources(supabase, enriched)

  return NextResponse.json({ resources: withContext })
}

// ── POST /api/projects/[id]/resources ─────────────────────────────────────────
// Link:  { url, title?, context_version_id?, context_track_id? }
// Presign: { action: "presign", filename, fileSize, contentType? }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { userId, project } = access

  let body: {
    action?: string
    url?: string
    title?: string
    filename?: string
    fileSize?: number
    contentType?: string
    context_version_id?: string | null
    context_track_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'presign' || (body.filename && body.fileSize != null && !body.url)) {
    try {
      const result = await presignResourceUpload(
        supabase,
        project.band_id,
        body.filename ?? '',
        body.fileSize ?? 0,
        body.contentType,
      )
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, ...(result.code ? { code: result.code } : {}) },
          { status: result.status },
        )
      }
      return NextResponse.json({ presignedUrl: result.presignedUrl, tempKey: result.tempKey })
    } catch (err) {
      console.error('[resources POST presign] unexpected error:', err)
      return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
    }
  }

  const { url, title, context_version_id, context_track_id } = body
  if (!url || typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // Validate URL
  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
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

  // Compute position (append at end)
  const { count } = await supabase
    .from('project_resources')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('type', 'link')

  const { data: resource, error } = await supabase
    .from('project_resources')
    .insert({
      project_id: projectId,
      type: 'link',
      url: url.trim(),
      title: title?.trim() || null,
      created_by: userId,
      position: count ?? 0,
      context_version_id: ctx.context_version_id,
      context_track_id: ctx.context_track_id,
    })
    .select()
    .single()

  if (error) {
    console.error('[resources POST] DB error:', error)
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 })
  }

  void logActivity({
    bandId: project.band_id,
    userId,
    action: 'resource',
    subject: title?.trim() || url.trim(),
    detail: 'added link',
    projectId,
  })

  return NextResponse.json({ resource: (await enrichResources(supabase, [resource]))[0] }, { status: 201 })
}

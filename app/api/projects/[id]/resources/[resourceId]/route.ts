import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity, resourceSubject } from '@/lib/activity'
import { enrichResources, validateResourceContext } from '@/lib/resource-context'
import { deleteFromR2 } from '@/lib/r2'
import { getUserIdFromToken } from '@/lib/supabase/server'

// ── Helper ────────────────────────────────────────────────────────────────────

async function resolveResource(projectId: string, resourceId: string, userId: string) {
  // Verify project membership
  const { data: project } = await supabase
    .from('projects')
    .select('id, band_id')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Project not found', status: 404 }

  const { data: member } = await supabase
    .from('band_members')
    .select('id')
    .eq('band_id', project.band_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!member) return { error: 'Not a member of this band', status: 403 }

  const { data: resource } = await supabase
    .from('project_resources')
    .select('*')
    .eq('id', resourceId)
    .eq('project_id', projectId)
    .single()
  if (!resource) return { error: 'Resource not found', status: 404 }

  return { project, resource }
}

// ── PATCH /api/projects/[id]/resources/[resourceId] ───────────────────────────
// Update title and/or url of a resource.
// Body: { title?: string, url?: string }

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  const { id: projectId, resourceId } = await params

  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveResource(projectId, resourceId, userId)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { project, resource } = resolved

  let body: {
    title?: string
    url?: string
    context_version_id?: string | null
    context_track_id?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof body.title === 'string') patch.title = body.title.trim() || null
  if (typeof body.url === 'string') {
    if (resource.type !== 'link') {
      return NextResponse.json({ error: 'url can only be set on link resources' }, { status: 400 })
    }
    try {
      new URL(body.url)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
    patch.url = body.url.trim()
  }

  if ('context_version_id' in body || 'context_track_id' in body) {
    if (resource.type !== 'file' && resource.type !== 'link') {
      return NextResponse.json({ error: 'Context can only be set on file or link resources' }, { status: 400 })
    }
    const versionInput = 'context_version_id' in body ? body.context_version_id : resource.context_version_id
    const trackInput = 'context_track_id' in body ? body.context_track_id : resource.context_track_id
    const ctx = await validateResourceContext(
      supabase,
      projectId,
      versionInput,
      trackInput,
    )
    if ('error' in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: 400 })
    }
    patch.context_version_id = ctx.context_version_id
    patch.context_track_id = ctx.context_track_id
  }

  const { data: updated, error } = await supabase
    .from('project_resources')
    .update(patch)
    .eq('id', resourceId)
    .select()
    .single()

  if (error) {
    console.error('[resources PATCH] error:', error)
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 })
  }

  const titleChanged = typeof body.title === 'string' && (body.title.trim() || null) !== (resource.title ?? null)
  const urlChanged = typeof body.url === 'string' && body.url.trim() !== (resource.url ?? '')
  if (titleChanged || urlChanged) {
    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'resource_update',
      subject: resourceSubject(resource),
      detail: resource.type === 'link' ? 'updated link' : 'updated file',
      projectId,
    })
  }

  return NextResponse.json({ resource: (await enrichResources(supabase, [updated]))[0] })
}

// ── DELETE /api/projects/[id]/resources/[resourceId] ──────────────────────────
// Delete a resource. For file resources, also removes the R2 object.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  const { id: projectId, resourceId } = await params

  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = await resolveResource(projectId, resourceId, userId)
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  }
  const { project, resource } = resolved

  const { error } = await supabase
    .from('project_resources')
    .delete()
    .eq('id', resourceId)

  if (error) {
    console.error('[resources DELETE] DB error:', error)
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 })
  }

  void logActivity({
    bandId: project.band_id,
    userId,
    action: 'resource_remove',
    subject: resourceSubject(resource),
    detail: resource.type === 'link' ? 'removed link'
      : resource.type === 'lyrics' ? 'removed lyrics'
      : resource.type === 'notes' ? 'removed note'
      : 'removed file',
    projectId,
  })

  // Clean up R2 object for file resources (fire-and-forget)
  if (resource.type === 'file' && resource.storage_path) {
    deleteFromR2(resource.storage_path).catch(err =>
      console.warn('[resources DELETE] R2 cleanup failed:', err),
    )
  }

  return new NextResponse(null, { status: 204 })
}

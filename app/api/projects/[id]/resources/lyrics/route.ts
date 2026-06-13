import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
import { getUserIdFromToken } from '@/lib/supabase/server'

// ── PUT /api/projects/[id]/resources/lyrics ───────────────────────────────────
// Upsert the lyrics resource for a project. There is at most one lyrics entry
// per project (enforced by upsert logic — not a DB unique constraint).
// Body: { content: string }  (empty string clears but keeps the row)

export async function PUT(
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

  let body: { content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const content = body.content ?? ''

  // Find existing lyrics row or create one
  const { data: existing } = await supabase
    .from('project_resources')
    .select('id, content')
    .eq('project_id', projectId)
    .eq('type', 'lyrics')
    .maybeSingle()

  let resource
  const isNew = !existing
  const prevContent = existing?.content ?? ''
  if (existing) {
    const { data, error } = await supabase
      .from('project_resources')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) {
      console.error('[resources/lyrics PUT] update error:', error)
      return NextResponse.json({ error: 'Failed to update lyrics' }, { status: 500 })
    }
    resource = data
  } else {
    const { data, error } = await supabase
      .from('project_resources')
      .insert({
        project_id: projectId,
        type: 'lyrics',
        content,
        created_by: userId,
        position: 0,
      })
      .select()
      .single()
    if (error) {
      console.error('[resources/lyrics PUT] insert error:', error)
      return NextResponse.json({ error: 'Failed to save lyrics' }, { status: 500 })
    }
    resource = data
  }

  if (isNew && content.trim()) {
    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'resource',
      subject: 'Lyrics',
      detail: 'added lyrics',
      projectId,
    })
  } else if (!isNew && content !== prevContent) {
    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'resource_update',
      subject: 'Lyrics',
      detail: content.trim() ? 'updated lyrics' : 'cleared lyrics',
      projectId,
    })
  }

  return NextResponse.json({ resource })
}

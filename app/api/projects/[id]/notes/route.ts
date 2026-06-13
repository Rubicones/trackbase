import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
import { getUserIdFromToken } from '@/lib/supabase/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function verifyAccess(projectId: string, userId: string | null) {
  const { data: project } = await supabase
    .from('projects')
    .select('id, band_id')
    .eq('id', projectId)
    .single()
  if (!project) return null

  if (userId) {
    const { data: member } = await supabase
      .from('band_members')
      .select('id')
      .eq('band_id', project.band_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!member) return null
  }

  return project
}

// ── GET /api/projects/[id]/notes ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null

  const project = await verifyAccess(projectId, userId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data } = await supabase
    .from('project_resources')
    .select('id, content, updated_at')
    .eq('project_id', projectId)
    .eq('type', 'notes')
    .maybeSingle()

  return NextResponse.json({ content: data?.content ?? null, updated_at: data?.updated_at ?? null })
}

// ── PUT /api/projects/[id]/notes ─────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params
  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await verifyAccess(projectId, userId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const content = body.content ?? ''

  const { data: existing } = await supabase
    .from('project_resources')
    .select('id, content')
    .eq('project_id', projectId)
    .eq('type', 'notes')
    .maybeSingle()

  let result
  const isNew = !existing
  const prevContent = existing?.content ?? ''
  if (existing) {
    const { data, error } = await supabase
      .from('project_resources')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id, content, updated_at')
      .single()
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    result = data
  } else {
    const { data, error } = await supabase
      .from('project_resources')
      .insert({ project_id: projectId, type: 'notes', content, created_by: userId, position: 0 })
      .select('id, content, updated_at')
      .single()
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    result = data
  }

  if (isNew && content.trim()) {
    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'resource',
      subject: 'Notes',
      detail: 'added note',
      projectId,
    })
  } else if (!isNew && content !== prevContent) {
    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'resource_update',
      subject: 'Notes',
      detail: content.trim() ? 'updated note' : 'cleared note',
      projectId,
    })
  }

  return NextResponse.json({ content: result.content, updated_at: result.updated_at })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
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

  return NextResponse.json({ resources: enriched })
}

// ── POST /api/projects/[id]/resources ─────────────────────────────────────────
// Creates a new 'link' resource.
// Body: { url: string, title?: string }

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { userId, project } = access

  let body: { url?: string; title?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { url, title } = body
  if (!url || typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  // Validate URL
  try {
    new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
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

  return NextResponse.json({ resource }, { status: 201 })
}

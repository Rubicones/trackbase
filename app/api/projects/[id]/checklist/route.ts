import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'

// GET /api/projects/[id]/checklist
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data, error } = await supabase
      .from('project_checklist_items')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ items: data ?? [] })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/[id]/checklist
// Body: { text: string, assignee_id?: string | null }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId } = access

    let body: { text?: string; assignee_id?: string | null }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const text = body.text?.trim()
    if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
    if (text.length > 500) return NextResponse.json({ error: 'text must be 500 characters or fewer' }, { status: 400 })

    // Append at end
    const { count } = await supabase
      .from('project_checklist_items')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    const { data, error } = await supabase
      .from('project_checklist_items')
      .insert({
        project_id: projectId,
        text,
        done: false,
        assignee_id: body.assignee_id ?? null,
        created_by: userId,
        position: count ?? 0,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ item: data }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'

// PATCH /api/projects/[id]/checklist/[itemId]
// Body: { text?: string, done?: boolean, assignee_id?: string | null }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: projectId, itemId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    // Verify item belongs to project
    const { data: existing } = await supabase
      .from('project_checklist_items')
      .select('id, done')
      .eq('id', itemId)
      .eq('project_id', projectId)
      .single()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let body: { text?: string; done?: boolean; assignee_id?: string | null }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}

    if (typeof body.text === 'string') {
      const text = body.text.trim()
      if (!text) return NextResponse.json({ error: 'text cannot be empty' }, { status: 400 })
      if (text.length > 500) return NextResponse.json({ error: 'text must be 500 characters or fewer' }, { status: 400 })
      patch.text = text
    }

    if (typeof body.done === 'boolean') {
      patch.done = body.done
      patch.done_at = body.done ? new Date().toISOString() : null
    }

    if ('assignee_id' in body) {
      patch.assignee_id = body.assignee_id ?? null
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('project_checklist_items')
      .update(patch)
      .eq('id', itemId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ item: data })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/[id]/checklist/[itemId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id: projectId, itemId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    // Verify item belongs to project
    const { data: existing } = await supabase
      .from('project_checklist_items')
      .select('id')
      .eq('id', itemId)
      .eq('project_id', projectId)
      .single()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { error } = await supabase
      .from('project_checklist_items')
      .delete()
      .eq('id', itemId)

    if (error) throw error

    return new NextResponse(null, { status: 204 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

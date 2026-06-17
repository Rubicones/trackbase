import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForSection } from '@/lib/supabase/server'
import { logActivity, sectionActivityLabel } from '@/lib/activity'

// PUT /api/sections/[id]
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForSection(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = await req.json()
    const { type, custom_name, start_bar, end_bar, chords, color, position } = body

    const updates: Record<string, unknown> = {}
    if (type !== undefined) updates.type = type
    if (custom_name !== undefined) updates.custom_name = custom_name
    if (start_bar !== undefined) updates.start_bar = start_bar
    if (end_bar !== undefined) updates.end_bar = end_bar
    if (chords !== undefined) updates.chords = chords
    if (color !== undefined) updates.color = color
    if (position !== undefined) updates.position = position

    const { data, error } = await supabase
      .from('sections')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ section: data })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/sections/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForSection(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const { data: sectionRow } = await supabase
      .from('sections')
      .select('type, custom_name')
      .eq('id', id)
      .single()

    const { error } = await supabase.from('sections').delete().eq('id', id)
    if (error) throw error

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'structure_remove',
      subject: sectionActivityLabel(sectionRow ?? { type: 'section' }),
      projectId: project.id,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

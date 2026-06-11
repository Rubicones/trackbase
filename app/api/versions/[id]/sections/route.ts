import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/versions/[id]/sections
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: versionId } = await params
    const { data, error } = await supabase
      .from('sections')
      .select('*')
      .eq('version_id', versionId)
      .order('start_bar', { ascending: true })
    if (error) throw error
    return NextResponse.json({ sections: data ?? [] })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/versions/[id]/sections
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: versionId } = await params
    const body = await req.json()
    const { type, custom_name, start_bar, end_bar, chords, color, position } = body

    // Fetch version to get project_id
    const { data: version, error: vErr } = await supabase
      .from('versions')
      .select('project_id')
      .eq('id', versionId)
      .single()
    if (vErr || !version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('sections')
      .insert({
        version_id: versionId,
        project_id: version.project_id,
        type,
        custom_name: custom_name ?? null,
        start_bar,
        end_bar,
        chords: chords ?? null,
        color,
        position,
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ section: data }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

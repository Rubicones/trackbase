import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForVersion } from '@/lib/supabase/server'

// GET /api/versions/[id]/sections
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: versionId } = await params

    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

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

    const access = await requireBandMemberForVersion(req, versionId)
    if (  'error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { version } = access

    const body = await req.json()
    const { type, custom_name, start_bar, end_bar, chords, color, position } = body

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

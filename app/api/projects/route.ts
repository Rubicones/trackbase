import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'

// POST /api/projects
// Body: { name: string, band_id?: string, bpm?: number, key?: string }
export async function POST(req: NextRequest) {
  try {
    const userId = await getRequestUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, band_id, bpm, key } = body

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    // If no band_id supplied, create an anonymous band
    let resolvedBandId = band_id
    if (!resolvedBandId) {
      const { data: band, error: bandErr } = await supabase
        .from('bands')
        .insert({ name: `${name} — band` })
        .select()
        .single()
      if (bandErr) throw bandErr
      resolvedBandId = band.id
    }

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({ name, band_id: resolvedBandId, bpm: bpm ?? null, key: key ?? null })
      .select()
      .single()
    if (projErr) throw projErr

    // Seed a "main" version automatically
    const { data: version, error: verErr } = await supabase
      .from('versions')
      .insert({ project_id: project.id, name: 'main', type: 'main' })
      .select()
      .single()
    if (verErr) throw verErr

    return NextResponse.json({ project, version }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

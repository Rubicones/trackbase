import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { serverErrorResponse } from '@/lib/apiErrors'
import { getRequestUserId } from '@/lib/supabase/server'
import { frozenBandRefusal } from '@/lib/planGuards'


// POST /api/bands/[id]/projects — create a project inside a band
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: bandId } = await params

  // Verify membership
  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const frozen = await frozenBandRefusal(bandId)
  if (frozen) return frozen

  const { name, bpm, key } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ name: name.trim(), band_id: bandId, bpm: bpm ?? 120, key: key ?? null })
    .select()
    .single()
  if (projErr) return serverErrorResponse('bands/projects', projErr, 'Could not create the song')

  // Seed main version
  const { data: version, error: verErr } = await supabase
    .from('versions')
    .insert({ project_id: project.id, name: 'Master', type: 'main' })
    .select()
    .single()
  if (verErr) return serverErrorResponse('bands/projects', verErr, 'Could not create the song')

  return NextResponse.json({ project, version }, { status: 201 })
}

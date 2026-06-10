import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// POST /api/bands/[id]/projects — create a project inside a band
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
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

  const { name, bpm, key } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ name: name.trim(), band_id: bandId, bpm: bpm ?? null, key: key ?? null })
    .select()
    .single()
  if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 })

  // Seed main version
  const { data: version, error: verErr } = await supabase
    .from('versions')
    .insert({ project_id: project.id, name: 'main', type: 'main' })
    .select()
    .single()
  if (verErr) return NextResponse.json({ error: verErr.message }, { status: 500 })

  return NextResponse.json({ project, version }, { status: 201 })
}

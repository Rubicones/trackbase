import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { ensureBandInviteCode } from '@/lib/inviteCode'

// POST /api/projects
// Body: { name: string, band_id?: string, bpm?: number, key?: string }
export async function POST(req: NextRequest) {
  try {
    const userId = await getRequestUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { name, band_id, bpm, key } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    let resolvedBandId = band_id as string | undefined

    if (resolvedBandId) {
      const { data: membership } = await supabase
        .from('band_members')
        .select('role')
        .eq('band_id', resolvedBandId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!membership) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    } else {
      const { data: band, error: bandErr } = await supabase
        .from('bands')
        .insert({ name: `${name.trim()} — band` })
        .select()
        .single()
      if (bandErr) throw bandErr

      const { error: memberErr } = await supabase
        .from('band_members')
        .insert({ band_id: band.id, user_id: userId, role: 'owner' })
      if (memberErr) throw memberErr

      await ensureBandInviteCode(band.id)
      resolvedBandId = band.id
    }

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        band_id: resolvedBandId,
        bpm: bpm ?? null,
        key: key ?? null,
      })
      .select()
      .single()
    if (projErr) throw projErr

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

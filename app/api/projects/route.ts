import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { ensureBandInviteCode } from '@/lib/inviteCode'
import { frozenBandRefusal } from '@/lib/planGuards'
import {
  createBandForUser,
  BandLimitReachedError,
  bandLimitReachedBody,
  BAND_LIMIT_REACHED_STATUS,
  isBandLimitUnknown,
} from '@/lib/bandLimit'

// POST /api/projects
// Body: { name: string, band_id?: string, bpm?: number, key?: string }
//
// NOTE: omitting `band_id` makes this a band-creation path — it spins up an
// implicit band owned by the caller. It therefore goes through the same
// `createBandForUser` limit check as POST /api/bands.
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

      // A frozen band accepts no new projects.
      const frozen = await frozenBandRefusal(resolvedBandId)
      if (frozen) return frozen
    } else {
      const band = await createBandForUser(userId, `${name.trim()} — band`)
      await ensureBandInviteCode(band.id)
      resolvedBandId = band.id
    }

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        band_id: resolvedBandId,
        bpm: bpm ?? 120,
        key: key ?? null,
      })
      .select()
      .single()
    if (projErr) throw projErr

    const { data: version, error: verErr } = await supabase
      .from('versions')
      .insert({ project_id: project.id, name: 'Master', type: 'main' })
      .select()
      .single()
    if (verErr) throw verErr

    return NextResponse.json({ project, version }, { status: 201 })
  } catch (err) {
    if (err instanceof BandLimitReachedError) {
      return NextResponse.json(bandLimitReachedBody(err), { status: BAND_LIMIT_REACHED_STATUS })
    }
    if (isBandLimitUnknown(err)) {
      console.error('[projects] could not resolve band_limit', err)
      return NextResponse.json({ error: 'Could not verify your band limit' }, { status: 500 })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

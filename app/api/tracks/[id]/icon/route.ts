import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForTrack } from '@/lib/supabase/server'

// PATCH /api/tracks/[id]/icon — update icon_emoji and/or icon_color (track badge / waveform accent)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: trackId } = await params

    const access = await requireBandMemberForTrack(req, trackId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { icon_emoji, icon_color } = await req.json()

    const patch: Record<string, unknown> = {}
    if (typeof icon_color === 'string' && icon_color.trim()) patch.icon_color = icon_color.trim()
    if (typeof icon_emoji === 'string') patch.icon_emoji = icon_emoji || null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'icon_color or icon_emoji is required' }, { status: 400 })
    }

    const { data: track, error } = await supabase
      .from('tracks')
      .update(patch)
      .eq('id', trackId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ track })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

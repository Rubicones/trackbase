import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// PATCH /api/tracks/[id]/icon — update icon_color (track badge / waveform accent)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { icon_color } = await req.json()

    if (typeof icon_color !== 'string' || !icon_color.trim()) {
      return NextResponse.json({ error: 'icon_color is required' }, { status: 400 })
    }

    const { data: track, error } = await supabase
      .from('tracks')
      .update({ icon_color: icon_color.trim() })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ track })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

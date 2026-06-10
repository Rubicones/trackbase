import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

// PATCH /api/tracks/[id]/icon — update icon_emoji and icon_color (cosmetic only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: trackId } = await params
  const { icon_emoji, icon_color } = await req.json()

  const { error } = await supabase
    .from('tracks')
    .update({
      ...(icon_emoji !== undefined ? { icon_emoji } : {}),
      ...(icon_color !== undefined ? { icon_color } : {}),
    })
    .eq('id', trackId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

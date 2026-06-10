import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

// PATCH /api/tracks/[id]/rename — update display_name (cosmetic metadata only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: trackId } = await params
  const { name } = await req.json()

  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.trim().length > 40) {
    return NextResponse.json({ error: 'name must be 40 characters or fewer' }, { status: 400 })
  }

  // display_name stores the user-visible label; tracks.name stays as the original identifier
  const { error } = await supabase
    .from('tracks')
    .update({ display_name: name.trim() })
    .eq('id', trackId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, display_name: name.trim() })
}

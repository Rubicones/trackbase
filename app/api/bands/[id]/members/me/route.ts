import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

// DELETE /api/bands/[id]/members/me — leave a band
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 404 })

  // If the user is an owner, check there's at least one other owner
  if (membership.role === 'owner') {
    const { count } = await supabase
      .from('band_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('band_id', bandId)
      .eq('role', 'owner')

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Transfer ownership before leaving — you are the only owner' },
        { status: 400 }
      )
    }
  }

  const { error } = await supabase
    .from('band_members')
    .delete()
    .eq('band_id', bandId)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

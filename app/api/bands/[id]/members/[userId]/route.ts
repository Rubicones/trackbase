import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'

async function assertMember(bandId: string, userId: string) {
  const { data } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  return data ?? null
}

// PATCH /api/bands/[id]/members/[userId] — update own role_label or role_color
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const requesterId = await getRequestUserId(req)
  if (!requesterId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: bandId, userId: targetUserId } = await params

  if (requesterId !== targetUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(await assertMember(bandId, requesterId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { role_label, role_color } = await req.json()
  const { error } = await supabase
    .from('band_members')
    .update({ role_label, role_color })
    .eq('band_id', bandId)
    .eq('user_id', targetUserId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/bands/[id]/members/[userId] — remove a member
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const requesterId = await getRequestUserId(req)
  if (!requesterId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: bandId, userId: targetUserId } = await params

  const membership = await assertMember(bandId, requesterId)
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (requesterId !== targetUserId && membership.role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('band_members')
    .delete()
    .eq('band_id', bandId)
    .eq('user_id', targetUserId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

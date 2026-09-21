import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { serverErrorResponse } from '@/lib/apiErrors'
import { getRequestUserId } from '@/lib/supabase/server'
import { frozenBandRefusal } from '@/lib/planGuards'
import { countBandOwners, LAST_OWNER_REFUSAL } from '@/lib/bandAccess'

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

  // Band-level route: no `requireBandMember`, so the frozen block is explicit.
  // Editing a role label is a write like any other.
  const frozen = await frozenBandRefusal(bandId)
  if (frozen) return frozen

  const { role_label, role_color } = await req.json()
  const { error } = await supabase
    .from('band_members')
    .update({ role_label, role_color })
    .eq('band_id', bandId)
    .eq('user_id', targetUserId)

  if (error) return serverErrorResponse('bands/members', error, 'Could not update that role')
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

  // ── The band must not be left without an owner ────────────────────────────
  // The self-removal branch above skips the role check, so without this an
  // owner could DELETE their own membership: the band survives with no owner
  // row, the slot is freed on their account, and it can never be frozen again
  // — `ensureBandFreezeState()` returns early on a null owner. The same guard
  // already lives in `DELETE .../members/me`; it belongs here too, and is
  // written against the TARGET rather than the requester so it holds for
  // every path into this branch, not just self-removal.
  //
  // Not a transaction: two concurrent last-owner removals could in principle
  // both read 1 and both delete. That race needs two owners to exist, in which
  // case neither is the last one — so the window this guard covers is a band
  // with exactly one owner, where there is only one request that can pass the
  // authorisation check above. Left as a read-then-write deliberately.
  const target =
    requesterId === targetUserId ? membership : await assertMember(bandId, targetUserId)
  if (target?.role === 'owner' && (await countBandOwners(bandId)) <= 1) {
    return NextResponse.json({ error: LAST_OWNER_REFUSAL }, { status: 400 })
  }

  const { error } = await supabase
    .from('band_members')
    .delete()
    .eq('band_id', bandId)
    .eq('user_id', targetUserId)

  if (error) return serverErrorResponse('bands/members', error, 'Could not remove that member')
  return NextResponse.json({ ok: true })
}

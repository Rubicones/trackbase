import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { normalizeInviteCode } from '@/lib/inviteCode'
import { sendPushNotification } from '@/lib/push/server'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// POST /api/bands/join — submit a join request (owner must approve)
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const code = normalizeInviteCode(body.code ?? '')
  if (!code) return NextResponse.json({ error: 'Invite code is required' }, { status: 400 })

  const { data: band } = await supabase
    .from('bands')
    .select('id, name')
    .eq('invite_code', code)
    .maybeSingle()

  if (!band) {
    return NextResponse.json({ error: 'No band found for that code' }, { status: 404 })
  }

  const { data: existingMember } = await supabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', band.id)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingMember) {
    return NextResponse.json({
      band_id: band.id,
      band_name: band.name,
      already_member: true,
    })
  }

  const { data: pending } = await supabase
    .from('band_join_requests')
    .select('id')
    .eq('band_id', band.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()

  if (pending) {
    return NextResponse.json({
      band_id: band.id,
      band_name: band.name,
      request_id: pending.id,
      status: 'pending',
      already_requested: true,
    })
  }

  const { data: request, error } = await supabase
    .from('band_join_requests')
    .insert({
      band_id: band.id,
      user_id: userId,
      status: 'pending',
    })
    .select('id, status, created_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have a pending request for this band' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  void notifyOwnersOfJoinRequest(band.id, band.name, userId)

  return NextResponse.json({
    band_id: band.id,
    band_name: band.name,
    request_id: request.id,
    status: request.status,
  }, { status: 201 })
}

async function notifyOwnersOfJoinRequest(bandId: string, bandName: string, requesterId: string) {
  try {
    const [{ data: requesterProfile }, { data: owners }] = await Promise.all([
      supabase.from('profiles').select('username').eq('id', requesterId).maybeSingle(),
      supabase.from('band_members').select('user_id').eq('band_id', bandId).eq('role', 'owner'),
    ])

    const requesterUsername = requesterProfile?.username ?? 'someone'
    const ownerIds = (owners ?? []).map(o => o.user_id).filter(id => id !== requesterId)
    if (!ownerIds.length) return

    await Promise.allSettled(
      ownerIds.map(ownerId =>
        sendPushNotification(ownerId, {
          title: 'New join request',
          body: `@${requesterUsername} wants to join ${bandName}`,
          url: `/band/${bandId}?tab=members`,
        }),
      ),
    )
  } catch (err) {
    console.error('[bands/join] push notification error:', err)
  }
}

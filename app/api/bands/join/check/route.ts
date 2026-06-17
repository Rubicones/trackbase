import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { normalizeInviteCode } from '@/lib/inviteCode'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// GET /api/bands/join/check?code=XXX — preview a band for a valid invite code
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('code') ?? ''
  const code = normalizeInviteCode(raw)
  if (!code) return NextResponse.json({ valid: false, error: 'Enter an invite code' })

  const { data: band } = await supabase
    .from('bands')
    .select('id, name')
    .eq('invite_code', code)
    .maybeSingle()

  if (!band) {
    return NextResponse.json({ valid: false, error: 'No band found for that code' })
  }

  const { data: existingMember } = await supabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', band.id)
    .eq('user_id', userId)
    .maybeSingle()

  if (existingMember) {
    return NextResponse.json({
      valid: false,
      error: 'You are already a member of this band',
      already_member: true,
      band_id: band.id,
    })
  }

  const { data: pending } = await supabase
    .from('band_join_requests')
    .select('id')
    .eq('band_id', band.id)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .maybeSingle()

  const { count: memberCount } = await supabase
    .from('band_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('band_id', band.id)

  return NextResponse.json({
    valid: true,
    band_id: band.id,
    band_name: band.name,
    member_count: memberCount ?? 0,
    pending_request: !!pending,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { assertBandOwner } from '@/lib/bandAccess'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// POST /api/bands/[id]/join-requests/[requestId] — owner approves or rejects
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId, requestId } = await params
  if (!(await assertBandOwner(bandId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }

  const { data: request, error: reqErr } = await supabase
    .from('band_join_requests')
    .select('id, band_id, user_id, status')
    .eq('id', requestId)
    .eq('band_id', bandId)
    .maybeSingle()

  if (reqErr || !request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'Request is no longer pending' }, { status: 409 })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('band_join_requests')
      .update({
        status: 'rejected',
        resolved_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'pending')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'rejected' })
  }

  const { data: existingMember } = await supabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', bandId)
    .eq('user_id', request.user_id)
    .maybeSingle()

  if (!existingMember) {
    const { error: memberErr } = await supabase
      .from('band_members')
      .insert({ band_id: bandId, user_id: request.user_id, role: 'member' })

    if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from('band_join_requests')
    .update({
      status: 'approved',
      resolved_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending')

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ status: 'approved', band_id: bandId, user_id: request.user_id })
}

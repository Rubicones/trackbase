import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { assertBandOwner, isBandFrozenForWrite } from '@/lib/bandAccess'
import { assertCanAddMember, limitRefusalResponse } from '@/lib/planGuards'
import { BandFrozenError, FROZEN_REASON_PLAN_DOWNGRADE } from '@/lib/bandFreeze'
import { serverErrorResponse } from '@/lib/apiErrors'


// POST /api/bands/[id]/join-requests/[requestId] — owner approves or rejects
//
// Approving inserts into `band_members`, so it is subject to the band's member
// limit — resolved from the BAND OWNER's plan plus this band's `extra_member`
// addons. Rejecting is not: refusing someone never adds a row.
//
// Note the asymmetry with downgrades. Being over the member limit blocks
// ADDING a member; it never removes one. Existing members stay indefinitely.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  const userId = await getRequestUserId(req)
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

    if (error) return serverErrorResponse('bands/join-requests', error, 'Could not reject that request')
    return NextResponse.json({ status: 'rejected' })
  }

  const { data: existingMember } = await supabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', bandId)
    .eq('user_id', request.user_id)
    .maybeSingle()

  if (!existingMember) {
    try {
      // A frozen band accepts no new members — same rule as every other write.
      if (await isBandFrozenForWrite(bandId)) {
        throw new BandFrozenError(bandId, FROZEN_REASON_PLAN_DOWNGRADE)
      }
      await assertCanAddMember(bandId)
    } catch (err) {
      const refusal = limitRefusalResponse(err)
      if (refusal) return refusal
      throw err
    }

    const { error: memberErr } = await supabase
      .from('band_members')
      .insert({ band_id: bandId, user_id: request.user_id, role: 'member' })

    // The `trg_enforce_band_owner_limit` trigger can fire on this insert, and it
    // attaches `DETAIL: limit=<n> current=<n>`. Returning the raw message handed
    // the caller the exact shape of the rule refusing them — log it, don't ship it.
    if (memberErr) return serverErrorResponse('bands/join-requests', memberErr, 'Could not add that member')
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

  if (updateErr) return serverErrorResponse('bands/join-requests', updateErr, 'Could not approve that request')

  return NextResponse.json({ status: 'approved', band_id: bandId, user_id: request.user_id })
}

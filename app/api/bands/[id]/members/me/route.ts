import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { serverErrorResponse } from '@/lib/apiErrors'
import { countBandOwners, LAST_OWNER_REFUSAL } from '@/lib/bandAccess'

// DELETE /api/bands/[id]/members/me — leave a band
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 404 })

  // If the user is an owner, check there's at least one other owner. The same
  // guard runs in `DELETE .../members/[userId]`, against the same shared copy.
  if (membership.role === 'owner' && (await countBandOwners(bandId)) <= 1) {
    return NextResponse.json({ error: LAST_OWNER_REFUSAL }, { status: 400 })
  }

  const { error } = await supabase
    .from('band_members')
    .delete()
    .eq('band_id', bandId)
    .eq('user_id', userId)

  if (error) return serverErrorResponse('bands/members/me', error, 'Could not leave the space')
  return NextResponse.json({ ok: true })
}

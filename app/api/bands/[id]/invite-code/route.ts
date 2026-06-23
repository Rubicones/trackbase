import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { assertBandOwner } from '@/lib/bandAccess'
import { ensureBandInviteCode } from '@/lib/inviteCode'


// GET /api/bands/[id]/invite-code — owner views the band's invite code
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params
  if (!(await assertBandOwner(bandId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const code = await ensureBandInviteCode(bandId)
    return NextResponse.json({ invite_code: code })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to load invite code' }, { status: 500 })
  }
}

// POST /api/bands/[id]/invite-code — owner regenerates the invite code
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params
  if (!(await assertBandOwner(bandId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { generateUniqueInviteCode } = await import('@/lib/inviteCode')
    const { supabase } = await import('@/lib/supabase')
    const code = await generateUniqueInviteCode()
    const { data, error } = await supabase
      .from('bands')
      .update({ invite_code: code })
      .eq('id', bandId)
      .select('invite_code')
      .single()
    if (error) throw error
    return NextResponse.json({ invite_code: data.invite_code })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to regenerate invite code' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  // Verify membership
  const { data: member } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (member.role !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Try to find existing unused invite
  const { data: existing } = await supabase
    .from('band_invites')
    .select('id, token, created_at')
    .eq('band_id', bandId)
    .eq('uses_count', 0)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return NextResponse.json({ invite: existing })

  // Create new one
  const { data: newInvite, error } = await supabase
    .from('band_invites')
    .insert({ band_id: bandId, created_by: userId })
    .select('id, token, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invite: newInvite })
}

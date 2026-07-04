import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { getRequestUserId } from '@/lib/supabase/server'

// GET /api/bands/[id]/members — lightweight member list for the checklist assignee picker
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getRequestUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: bandId } = await params

    const { data: membership } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', bandId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const adminSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    )

    // Fetch membership rows and profiles as two plain queries and join in JS —
    // relying on PostgREST's embedded `profiles(...)` join here previously
    // silently 500'd (no FK relationship for it to auto-detect), which left
    // the checklist assignee picker with an empty member list.
    const { data: members, error: membersErr } = await adminSupabase
      .from('band_members')
      .select('user_id')
      .eq('band_id', bandId)
    if (membersErr) throw membersErr

    const memberUserIds = (members ?? []).map((m: { user_id: string }) => m.user_id)

    const { data: profiles, error: profilesErr } = memberUserIds.length
      ? await adminSupabase
          .from('profiles')
          .select('id, username, display_name')
          .in('id', memberUserIds)
      : { data: [] as { id: string; username: string; display_name: string | null }[], error: null }
    if (profilesErr) throw profilesErr

    const profileMap = new Map(
      (profiles ?? []).map(p => [p.id, p]),
    )

    const result = memberUserIds.map(userId => {
      const profile = profileMap.get(userId)
      return {
        user_id: userId,
        username: profile?.username ?? userId,
        display_name: profile?.display_name ?? null,
      }
    })

    return NextResponse.json({ members: result })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

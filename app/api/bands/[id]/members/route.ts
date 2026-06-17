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
    const userId = getRequestUserId(req)
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

    const { data: members, error } = await adminSupabase
      .from('band_members')
      .select('user_id, profiles(id, username, display_name)')
      .eq('band_id', bandId)

    if (error) throw error

    const result = (members ?? []).map((m: {
      user_id: string
      profiles: { id: string; username: string; display_name: string | null }[] | { id: string; username: string; display_name: string | null } | null
    }) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return {
        user_id: m.user_id,
        username: profile?.username ?? m.user_id,
        display_name: profile?.display_name ?? null,
      }
    })

    return NextResponse.json({ members: result })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

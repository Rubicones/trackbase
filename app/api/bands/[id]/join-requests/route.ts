import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { assertBandOwner } from '@/lib/bandAccess'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

const adminSupabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

// GET /api/bands/[id]/join-requests — owner lists pending join requests
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params
  if (!(await assertBandOwner(bandId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: requests, error } = await adminSupabase
    .from('band_join_requests')
    .select('id, user_id, status, created_at')
    .eq('band_id', bandId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const userIds = (requests ?? []).map(r => r.user_id)
  let profiles: Record<string, { username: string; display_name: string | null; avatar_color: string | null }> = {}

  if (userIds.length > 0) {
    const { data: profileRows } = await adminSupabase
      .from('profiles')
      .select('id, username, display_name, avatar_color')
      .in('id', userIds)

    for (const p of profileRows ?? []) {
      profiles[p.id] = {
        username: p.username,
        display_name: p.display_name,
        avatar_color: p.avatar_color,
      }
    }
  }

  return NextResponse.json({
    requests: (requests ?? []).map(r => ({
      id: r.id,
      user_id: r.user_id,
      status: r.status,
      created_at: r.created_at,
      profile: profiles[r.user_id] ?? null,
    })),
  })
}

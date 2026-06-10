import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// GET /api/bands/[id] — full band detail: projects, members, invites
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  // Verify membership
  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  const [bandRes, projectsRes, membersRes] = await Promise.all([
    supabase.from('bands').select('*').eq('id', bandId).single(),
    supabase.from('projects').select('id, name, bpm, key, created_at').eq('band_id', bandId).order('created_at', { ascending: false }),
    adminSupabase.from('band_members').select('user_id, role, role_label, role_color, joined_at').eq('band_id', bandId),
  ])

  // Fetch profiles separately (band_members.user_id → auth.users, not profiles directly)
  const memberUserIds = (membersRes.data ?? []).map((m: { user_id: string }) => m.user_id)
  const profilesRes = memberUserIds.length > 0
    ? await adminSupabase.from('profiles').select('id, username, display_name, avatar_color').in('id', memberUserIds)
    : { data: [] }

  const profileMap = new Map((profilesRes.data ?? []).map((p: { id: string; username: string; display_name: string | null; avatar_color: string | null }) => [p.id, p]))
  const members = (membersRes.data ?? []).map((m: { user_id: string; role: string; role_label: string | null; role_color: string | null; joined_at: string }) => ({
    ...m,
    profiles: profileMap.get(m.user_id) ?? null,
  }))

  if (bandRes.error) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    band: bandRes.data,
    projects: projectsRes.data ?? [],
    members,
    myRole: membership.role,
  })
}

// DELETE /api/bands/[id] — owner deletes band (cascades via FK)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (membership.role !== 'owner') return NextResponse.json({ error: 'Only owners can delete a band' }, { status: 403 })

  const { error } = await supabase.from('bands').delete().eq('id', bandId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

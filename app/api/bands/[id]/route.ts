import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

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

  const [bandRes, projectsRes, membersRes] = await Promise.all([
    supabase.from('bands').select('*').eq('id', bandId).single(),
    supabase.from('projects').select('id, name, bpm, key, created_at').eq('band_id', bandId).order('created_at', { ascending: false }),
    supabase.from('band_members').select(`
      user_id, role, role_label, role_color, joined_at,
      profiles (id, username, display_name, avatar_color)
    `).eq('band_id', bandId),
  ])

  if (bandRes.error) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    band: bandRes.data,
    projects: projectsRes.data ?? [],
    members: membersRes.data ?? [],
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

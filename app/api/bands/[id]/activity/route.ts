import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// GET /api/bands/[id]/activity — last 50 activity items for the band
export async function GET(
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

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  try {
    const { data, error } = await adminSupabase
      .from('band_activity')
      .select('id, action, subject, detail, created_at, user_id, project_id, projects(name)')
      .eq('band_id', bandId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ items: [] })

    const userIds = [...new Set((data ?? []).map((a: { user_id: string }) => a.user_id).filter(Boolean))]
    const { data: profiles } = userIds.length
      ? await adminSupabase.from('profiles').select('id, username').in('id', userIds)
      : { data: [] as { id: string; username: string }[] }

    const profileMap = new Map((profiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))
    const items = (data ?? []).map((a: { user_id: string; projects?: { name: string } | null }) => ({
      ...a,
      username: profileMap.get(a.user_id) ?? 'unknown',
      project_name: a.projects?.name ?? null,
      projects: undefined,
    }))

    return NextResponse.json({ items })
  } catch {
    // band_activity table may not exist yet
    return NextResponse.json({ items: [] })
  }
}

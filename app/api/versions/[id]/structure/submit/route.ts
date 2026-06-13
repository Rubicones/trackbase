import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
import { getUserIdFromToken } from '@/lib/supabase/server'

// POST /api/versions/[id]/structure/submit — log structure submission to band activity
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = req.cookies.get('sb-at')?.value
    const userId = token ? getUserIdFromToken(token) : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: versionId } = await params

    const { data: version, error: vErr } = await supabase
      .from('versions')
      .select('id, project_id, projects(id, name, band_id)')
      .eq('id', versionId)
      .single()
    if (vErr || !version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

    const project = version.projects as { id: string; name: string; band_id: string } | null
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { data: membership } = await supabase
      .from('band_members')
      .select('id')
      .eq('band_id', project.band_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { count } = await supabase
      .from('sections')
      .select('id', { count: 'exact', head: true })
      .eq('version_id', versionId)

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'structure',
      subject: 'new structure',
      detail: count != null ? `${count} section${count === 1 ? '' : 's'}` : null,
      projectId: project.id,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

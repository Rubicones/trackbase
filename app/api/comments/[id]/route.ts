import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForComment } from '@/lib/supabase/server'
import { logActivity, fmtTimecode } from '@/lib/activity'

// DELETE /api/comments/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForComment(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const [{ data: commentRow }, { data: projectMeta }] = await Promise.all([
      supabase.from('track_comments').select('timecode_start_ms').eq('id', id).single(),
      supabase.from('projects').select('name').eq('id', project.id).single(),
    ])

    const { error } = await supabase.from('track_comments').delete().eq('id', id)
    if (error) throw error

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'comment_remove',
      subject: projectMeta?.name ?? 'Project',
      detail: commentRow ? fmtTimecode(commentRow.timecode_start_ms) : null,
      projectId: project.id,
    })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[comments/delete]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

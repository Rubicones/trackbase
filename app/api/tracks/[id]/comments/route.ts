import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { logActivity, fmtTimecode } from '@/lib/activity'

// POST /api/tracks/[id]/comments
// Body: { content: string, timecode_start_ms: number, timecode_end_ms: number }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.cookies.get('sb-at')?.value
    const userId = token ? getUserIdFromToken(token) : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: trackId } = await params
    const body = await req.json()
    const { content, timecode_start_ms, timecode_end_ms } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }
    if (typeof timecode_start_ms !== 'number') {
      return NextResponse.json({ error: 'timecode_start_ms is required' }, { status: 400 })
    }
    if (typeof timecode_end_ms !== 'number') {
      return NextResponse.json({ error: 'timecode_end_ms is required' }, { status: 400 })
    }
    if (timecode_end_ms <= timecode_start_ms) {
      return NextResponse.json({ error: 'timecode_end_ms must be greater than timecode_start_ms' }, { status: 400 })
    }

    // Get version_id from track
    const { data: track, error: trkErr } = await supabase
      .from('tracks')
      .select('id, version_id')
      .eq('id', trackId)
      .single()
    if (trkErr) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const { data: comment, error } = await supabase
      .from('track_comments')
      .insert({
        track_id: trackId,
        version_id: track.version_id,
        content: content.trim(),
        timecode_start_ms,
        timecode_end_ms,
        created_by: userId,
      })
      .select()
      .single()

    if (error) {
      console.error('[comments/post] Supabase error:', error)
      return NextResponse.json(
        { error: error.message, details: error.details, hint: error.hint },
        { status: 500 }
      )
    }

    // Fetch author username
    const { data: authorProfile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', comment.created_by)
      .maybeSingle()

    const commentWithAuthor = {
      ...comment,
      author_username: authorProfile?.username ?? 'unknown',
      replies: [],
    }

    // Log activity (fire-and-forget)
    supabase
      .from('versions').select('project_id').eq('id', track.version_id).maybeSingle()
      .then(({ data: ver }) => ver
        ? supabase.from('projects').select('band_id, name').eq('id', ver.project_id).maybeSingle()
            .then(({ data: proj }) => {
              if (proj) logActivity({
                bandId: proj.band_id, userId, action: 'comment',
                subject: proj.name, detail: fmtTimecode(timecode_start_ms),
                projectId: ver.project_id,
              })
            })
        : null
      )

    return NextResponse.json({ comment: commentWithAuthor }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comments/post] Unexpected error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

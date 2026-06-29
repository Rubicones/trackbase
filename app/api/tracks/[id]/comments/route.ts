import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { logActivity, fmtTimecode } from '@/lib/activity'
import { commentToTimelineMs } from '@/lib/commentTimecodes'
import { trackStartBar } from '@/lib/trackMerge'

// POST /api/tracks/[id]/comments
// Body: { content, timecode_start_ms, timecode_end_ms } — ms relative to track content (waveform)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: trackId } = await params

    const access = await requireBandMemberForTrack(req, trackId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, track } = access

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

    // Resolve the owning project, then mirror the comment into band chat and
    // log activity. Done server-side (service role) so the auto-generated chat
    // message is created exactly once, regardless of how many clients are online.
    const { data: ver } = await supabase
      .from('versions').select('project_id').eq('id', track.version_id).maybeSingle()
    if (ver) {
      const [{ data: proj }, { data: trackRow }] = await Promise.all([
        supabase.from('projects').select('band_id, name, bpm, time_signature').eq('id', ver.project_id).maybeSingle(),
        supabase.from('tracks').select('start_bar, midi_start_bar').eq('id', trackId).maybeSingle(),
      ])
      if (proj) {
        const startBar = trackStartBar(trackRow)
        const timelineStartMs = commentToTimelineMs(
          timecode_start_ms,
          startBar,
          proj.bpm ?? 120,
          proj.time_signature ?? '4/4',
        )
        const timelineEndMs = commentToTimelineMs(
          timecode_end_ms,
          startBar,
          proj.bpm ?? 120,
          proj.time_signature ?? '4/4',
        )

        // Auto-generated track-comment message in the project's channel.
        const { error: msgError } = await supabase.from('band_messages').insert({
          band_id: proj.band_id,
          channel_id: ver.project_id,
          user_id: comment.created_by,
          content: comment.content,
          type: 'track_comment',
          context_version_id: comment.version_id,
          context_track_id: comment.track_id,
          context_timecode_start_ms: timelineStartMs,
          context_timecode_end_ms: timelineEndMs,
          source_track_comment_id: comment.id,
        })
        if (msgError) console.error('[comments/post] band_messages insert error:', msgError)

        logActivity({
          bandId: proj.band_id, userId, action: 'comment',
          subject: proj.name, detail: fmtTimecode(timelineStartMs),
          projectId: ver.project_id,
        })
      }
    }

    return NextResponse.json({ comment: commentWithAuthor }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[comments/post] Unexpected error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/tracks/[id]/comments
// Body: { content: string, timecode_ms: number }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: trackId } = await params
    const { content, timecode_ms } = await req.json()

    if (!content?.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }
    if (typeof timecode_ms !== 'number') {
      return NextResponse.json({ error: 'timecode_ms is required' }, { status: 400 })
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
        timecode_ms,
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ comment }, { status: 201 })
  } catch (err) {
    console.error('[comments/post]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

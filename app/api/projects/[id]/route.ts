import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/projects/[id]
// Returns project + all versions + tracks (with comments) per version
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .single()
    if (projErr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: versions, error: verErr } = await supabase
      .from('versions')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
    if (verErr) throw verErr

    const versionIds = (versions ?? []).map((v: { id: string }) => v.id)

    const { data: tracks, error: trkErr } = await supabase
      .from('tracks')
      .select('*')
      .in('version_id', versionIds)
      .order('position', { ascending: true })
    if (trkErr) throw trkErr

    const trackIds = (tracks ?? []).map((t: { id: string }) => t.id)

    // Load comments for all tracks in one query
    const { data: comments } = trackIds.length
      ? await supabase
          .from('track_comments')
          .select('*')
          .in('track_id', trackIds)
          .order('timecode_ms', { ascending: true })
      : { data: [] }

    const tracksWithComments = (tracks ?? []).map((t: Record<string, unknown>) => ({
      ...t,
      comments: (comments ?? []).filter(
        (c: Record<string, unknown>) => c.track_id === t.id
      ),
    }))

    const versionsWithTracks = (versions ?? []).map((v: Record<string, unknown>) => ({
      ...v,
      tracks: tracksWithComments.filter(
        (t: Record<string, unknown>) => t.version_id === v.id
      ),
    }))

    return NextResponse.json({ project, versions: versionsWithTracks })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

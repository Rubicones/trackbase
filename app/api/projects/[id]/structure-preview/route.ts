import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { projectTimelineDurationMs } from '@/lib/trackMerge'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// GET /api/projects/[id]/structure-preview
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = getUserId(req)
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: projectId } = await params

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, band_id, name, bpm, key, time_signature')
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: membership } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', project.band_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: versions, error: verErr } = await supabase
      .from('versions')
      .select('id, name, type')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (verErr) throw verErr

    const mainVersion = (versions ?? []).find(v => v.type === 'main')
    if (!mainVersion) {
      return NextResponse.json({ error: 'No main version found' }, { status: 404 })
    }

    const [sectionsRes, tracksRes] = await Promise.all([
      supabase
        .from('sections')
        .select('*')
        .eq('version_id', mainVersion.id)
        .order('start_bar', { ascending: true }),
      supabase
        .from('tracks')
        .select('duration_ms, start_bar, midi_start_bar, file_type, midi_data')
        .eq('version_id', mainVersion.id),
    ])

    if (sectionsRes.error) throw sectionsRes.error
    if (tracksRes.error) throw tracksRes.error

    const tracks = tracksRes.data ?? []
    const totalDurationMs = projectTimelineDurationMs(
      tracks,
      project.bpm,
      project.time_signature,
    )

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        bpm: project.bpm,
        key: project.key,
        time_signature: project.time_signature ?? '4/4',
        track_count: tracks.length,
        total_duration_ms: totalDurationMs,
      },
      versions: (versions ?? []).map(v => ({
        id: v.id,
        name: v.name,
        type: v.type,
      })),
      sections: sectionsRes.data ?? [],
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

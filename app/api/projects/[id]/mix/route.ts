import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { openR2Streams } from '@/lib/r2'
import { mixStreamsToMp3 } from '@/lib/ffmpeg'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { readFile, unlink } from 'fs/promises'
import path from 'path'
import { requireBandMember } from '@/lib/supabase/server'
import { r2ObjectResponse } from '@/lib/trackDelivery'

// GET /api/projects/[id]/mix
// Downloads all tracks from the project's main version, mixes them with ffmpeg
// amix, and returns the result as MP3.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  // Find the main version
  const { data: mainVersion, error: mvErr } = await supabase
    .from('versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('type', 'main')
    .maybeSingle()

  if (mvErr || !mainVersion) {
    return NextResponse.json({ error: 'No main version found' }, { status: 404 })
  }

  // Get all tracks ordered by position — exclude MIDI (not mixable audio)
  const { data: allTracks, error: trkErr } = await supabase
    .from('tracks')
    .select('id, storage_path, position, file_type')
    .eq('version_id', mainVersion.id)
    .order('position', { ascending: true })

  if (trkErr || !allTracks?.length) {
    return NextResponse.json({ error: 'No tracks found' }, { status: 404 })
  }

  // Filter to audio-only tracks (skip MIDI files — ffmpeg can't amix them as audio)
  const tracks = allTracks.filter(t =>
    t.file_type !== 'midi' &&
    !t.storage_path?.toLowerCase().endsWith('.mid') &&
    !t.storage_path?.toLowerCase().endsWith('.midi')
  )

  if (!tracks.length) {
    return NextResponse.json({ error: 'No audio tracks found' }, { status: 404 })
  }

  // Single audio track — skip ffmpeg, stream the object through (never buffered).
  if (tracks.length === 1) {
    const ext = tracks[0].storage_path.split('.').pop()?.toLowerCase()
    const contentType = ext === 'mp3' ? 'audio/mpeg'
      : ext === 'wav' ? 'audio/wav'
      : ext === 'ogg' ? 'audio/ogg'
      : 'audio/flac'
    return r2ObjectResponse(req, tracks[0].storage_path, { contentType })
  }

  const id = randomUUID()
  const outPath = path.join(tmpdir(), `${id}-mix.mp3`)

  try {
    // Stems stream from R2 into ffmpeg (one pipe each) — nothing buffered or staged.
    const inputs = await openR2Streams(tracks.map(t => t.storage_path))
    const labels = inputs.map((_, i) => `[${i}:a]`).join('')
    await mixStreamsToMp3({
      inputs,
      filterGraph: `${labels}amix=inputs=${inputs.length}:duration=longest[out]`,
      outPath,
      bitrate: '192k',
    })

    const mixed = await readFile(outPath)
    return new NextResponse(new Uint8Array(mixed), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(mixed.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

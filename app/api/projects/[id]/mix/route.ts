import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { ensureFfmpegConfigured } from '@/lib/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'
import { requireBandMember } from '@/lib/supabase/server'

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

  // Single audio track — skip ffmpeg, proxy directly
  if (tracks.length === 1) {
    const buffer = await downloadFromR2(tracks[0].storage_path)
    // Detect type by extension so the browser picks the right decoder
    const ext = tracks[0].storage_path.split('.').pop()?.toLowerCase()
    const contentType = ext === 'mp3' ? 'audio/mpeg'
      : ext === 'wav' ? 'audio/wav'
      : ext === 'ogg' ? 'audio/ogg'
      : 'audio/flac'
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  }

  // Download all audio buffers in parallel
  const buffers = await Promise.all(tracks.map(t => downloadFromR2(t.storage_path)))

  ensureFfmpegConfigured()
  const id = randomUUID()
  const tmpPaths: string[] = []
  const outPath = path.join(tmpdir(), `${id}-mix.mp3`)

  try {
    for (let i = 0; i < buffers.length; i++) {
      // Preserve original extension so ffmpeg reads the correct container format
      const origExt = tracks[i].storage_path.split('.').pop()?.toLowerCase() ?? 'flac'
      const p = path.join(tmpdir(), `${id}-track${i}.${origExt}`)
      await writeFile(p, buffers[i])
      tmpPaths.push(p)
    }

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg()
      for (const p of tmpPaths) cmd.input(p)
      cmd
        .complexFilter([`amix=inputs=${tmpPaths.length}:duration=longest`])
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(outPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
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
    for (const p of tmpPaths) await unlink(p).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

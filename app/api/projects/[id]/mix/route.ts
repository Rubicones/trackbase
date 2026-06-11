import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'

function getFfmpegPath(): string {
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch { /* not in PATH */ }
  throw new Error('ffmpeg binary not found')
}
ffmpeg.setFfmpegPath(getFfmpegPath())

// GET /api/projects/[id]/mix
// Downloads all tracks from the project's main version, mixes them with ffmpeg
// amix, and returns the result as MP3.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

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

  // Get all tracks ordered by position
  const { data: tracks, error: trkErr } = await supabase
    .from('tracks')
    .select('id, storage_path, position')
    .eq('version_id', mainVersion.id)
    .order('position', { ascending: true })

  if (trkErr || !tracks?.length) {
    return NextResponse.json({ error: 'No tracks found' }, { status: 404 })
  }

  // Single track — skip ffmpeg, just proxy it directly
  if (tracks.length === 1) {
    const buffer = await downloadFromR2(tracks[0].storage_path)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'audio/flac',
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    })
  }

  // Download all FLAC buffers in parallel
  const buffers = await Promise.all(tracks.map(t => downloadFromR2(t.storage_path)))

  const id = randomUUID()
  const tmpPaths: string[] = []
  const outPath = path.join(tmpdir(), `${id}-mix.mp3`)

  try {
    for (let i = 0; i < buffers.length; i++) {
      const p = path.join(tmpdir(), `${id}-track${i}.flac`)
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
        .on('end', resolve)
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

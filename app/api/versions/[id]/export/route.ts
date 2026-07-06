import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { flacToWav } from '@/lib/ffmpeg'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream } from 'fs'
import archiver from 'archiver'

// GET /api/versions/[id]/export
// Returns a zip archive of all tracks converted back to WAV.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tmpDir = path.join(tmpdir(), randomUUID())

  try {
    const { id: versionId } = await params

    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    // Fetch tracks
    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', versionId)
      .order('position', { ascending: true })
    if (error) throw error
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No tracks found' }, { status: 404 })
    }

    // Fetch version → project name/tempo (tempo needed to convert each track's
    // start_bar offset into a silence-pad/trim duration for the exported WAV).
    const { data: version } = await supabase
      .from('versions')
      .select('name, projects(name, bpm, time_signature)')
      .eq('id', versionId)
      .single()

    const project = version?.projects as unknown as
      { name: string; bpm: number | null; time_signature: string | null } | null
    const projectName = project?.name ?? 'project'
    const versionName = version?.name ?? 'export'
    const bpm = project?.bpm ?? 120
    const timeSignature = project?.time_signature ?? '4/4'
    const archiveName = `${projectName}-${versionName}.zip`
      .toLowerCase()
      .replace(/\s+/g, '-')

    await mkdir(tmpDir, { recursive: true })

    // Convert each FLAC back to WAV and write to tmpDir
    await Promise.all(
      tracks.map(async (track: {
        storage_path: string
        position: number
        name: string
        start_bar?: number | null
        midi_start_bar?: number | null
      }) => {
        const flacBuffer = await downloadFromR2(track.storage_path)
        const delayMs = startBarToMs(trackStartBar(track), bpm, timeSignature)
        const wavBuffer = await flacToWav(flacBuffer, delayMs)
        const filename = `${String(track.position).padStart(2, '0')}-${track.name.replace(/\//g, '_')}.wav`
        await writeFile(path.join(tmpDir, filename), wavBuffer)
      })
    )

    // Build the zip in-process (no `zip` CLI — not available in the serverless runtime).
    const zipPath = path.join(tmpdir(), `${randomUUID()}.zip`)
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath)
      const archive = archiver('zip', { zlib: { level: 9 } })
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      archive.glob('*.wav', { cwd: tmpDir })
      archive.finalize()
    })

    // Stream zip back
    const stat = await import('fs').then((m) =>
      m.promises.stat(zipPath)
    )
    const stream = createReadStream(zipPath)
    const nodeStream = stream as unknown as ReadableStream

    return new NextResponse(nodeStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${archiveName}"`,
        'Content-Length': String(stat.size),
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  } finally {
    // Best-effort cleanup
    import('fs').then((m) => m.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))
  }
}

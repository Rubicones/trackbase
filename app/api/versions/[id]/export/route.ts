import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { flacToWavFile } from '@/lib/ffmpeg'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'
import { attachmentDisposition } from '@/lib/contentDisposition'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { mkdir, writeFile, rm, stat } from 'fs/promises'
import path from 'path'
import { createReadStream, createWriteStream } from 'fs'
import archiver from 'archiver'

// Transcoding every stem is minutes of work for a big project; the platform
// default would cut it off mid-zip.
export const maxDuration = 300

interface ExportTrack {
  storage_path: string | null
  position: number | null
  name: string | null
  file_type: string | null
  start_bar?: number | null
  midi_start_bar?: number | null
}

/** Filesystem-safe, collision-free member name for a track inside the zip. */
function memberName(track: ExportTrack, index: number, used: Set<string>, ext: string) {
  const position = track.position ?? index + 1
  const base = (track.name ?? `track-${position}`)
    // Windows/macOS both choke on these inside a zip entry.
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim() || `track-${position}`

  let candidate = `${String(position).padStart(2, '0')}-${base}.${ext}`
  let n = 2
  while (used.has(candidate)) {
    candidate = `${String(position).padStart(2, '0')}-${base} (${n}).${ext}`
    n += 1
  }
  used.add(candidate)
  return candidate
}

// GET /api/versions/[id]/export
// Returns a zip archive of all tracks: audio converted back to WAV, MIDI as .mid.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tmpDir = path.join(tmpdir(), randomUUID())
  const zipPath = path.join(tmpdir(), `${randomUUID()}.zip`)
  let stage = 'init'

  try {
    const { id: versionId } = await params

    stage = 'auth'
    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    stage = 'fetch-tracks'
    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('storage_path, position, name, file_type, start_bar, midi_start_bar')
      .eq('version_id', versionId)
      .order('position', { ascending: true })
    if (error) throw error
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No tracks found' }, { status: 404 })
    }

    // A row with no object behind it (failed upload) must not abort the whole
    // export — it just has nothing to contribute.
    const exportable = (tracks as ExportTrack[]).filter((t) => !!t.storage_path)
    if (exportable.length === 0) {
      return NextResponse.json({ error: 'No downloadable tracks in this version' }, { status: 404 })
    }

    stage = 'fetch-version'
    // Tempo is needed to convert each track's start_bar offset into a
    // silence-pad/trim duration for the exported WAV.
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

    // Sequential on purpose. Promise.all held every stem's FLAC *and* its
    // decoded 24-bit WAV (~17 MB per stereo minute) in memory at once, which
    // blows the function's heap and /tmp budget on any real project.
    const used = new Set<string>()
    for (const [index, track] of exportable.entries()) {
      stage = `download:${track.name ?? index}`
      const buffer = await downloadFromR2(track.storage_path as string)

      if (track.file_type === 'midi') {
        // ffmpeg cannot decode MIDI without a soundfont — feeding a .mid to
        // flacToWav throws and used to take the entire export down with it.
        await writeFile(path.join(tmpDir, memberName(track, index, used, 'mid')), buffer)
        continue
      }

      stage = `transcode:${track.name ?? index}`
      const delayMs = startBarToMs(trackStartBar(track), bpm, timeSignature)
      await flacToWavFile(buffer, path.join(tmpDir, memberName(track, index, used, 'wav')), delayMs)
    }

    // Build the zip in-process (no `zip` CLI — not available in the serverless runtime).
    stage = 'zip'
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath)
      // Level 9 on already-compressed-in-spirit PCM buys little and costs a
      // lot of CPU time inside the function budget.
      const archive = archiver('zip', { zlib: { level: 1 } })
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      archive.directory(tmpDir, false)
      archive.finalize().catch(reject)
    })

    stage = 'stream'
    const { size } = await stat(zipPath)
    const stream = createReadStream(zipPath)
    // The zip outlives this handler, so it can only be removed once the body
    // has actually been read off disk.
    const cleanup = () => {
      rm(zipPath, { force: true }).catch(() => {})
    }
    stream.on('close', cleanup)
    stream.on('error', cleanup)

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(archiveName),
        'Content-Length': String(size),
      },
    })
  } catch (err) {
    console.error(`[versions/export] failed at stage=${stage}`, err)
    await rm(zipPath, { force: true }).catch(() => {})
    return NextResponse.json(
      { error: 'Export failed', stage, detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  } finally {
    // Best-effort cleanup of the staged stems (the zip is handled above).
    rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

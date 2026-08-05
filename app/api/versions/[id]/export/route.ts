import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { flacToWavFile } from '@/lib/ffmpeg'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'
import { attachmentDisposition } from '@/lib/contentDisposition'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import archiver from 'archiver'

// Transcoding every stem is minutes of work for a big project; the platform
// default would cut it off mid-zip.
export const maxDuration = 300

/** Bytes per second of the export format: 48 kHz × 24-bit × stereo. */
const WAV_BYTES_PER_SECOND = 48000 * 3 * 2

/**
 * How much of the serverless function's 512 MB `/tmp` the staged stems may
 * claim. The rest is headroom for ffmpeg's own scratch files and for any other
 * request sharing the same warm instance — `/tmp` is per-instance, not
 * per-invocation. Exceeding it used to surface as a bare
 * `ENOSPC: no space left on device` from deep inside the zip step.
 */
const TMP_STAGING_BUDGET_BYTES = 380 * 1024 * 1024

interface ExportTrack {
  storage_path: string | null
  position: number | null
  name: string | null
  file_type: string | null
  duration_ms: number | null
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
  const dropTmpDir = () => { rm(tmpDir, { recursive: true, force: true }).catch(() => {}) }
  // Once the archive owns the staged files, this handler must not delete them
  // out from under it — cleanup moves onto the stream's lifecycle events.
  let streaming = false
  let stage = 'init'

  try {
    const { id: versionId } = await params

    stage = 'auth'
    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    stage = 'fetch-tracks'
    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('storage_path, position, name, file_type, duration_ms, start_bar, midi_start_bar')
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

    const delayMsFor = (track: ExportTrack) =>
      startBarToMs(trackStartBar(track), bpm, timeSignature)

    // Refuse up front rather than filling /tmp and failing mid-zip with ENOSPC.
    // Tracks with no stored duration contribute 0 — the estimate is a guard
    // rail, not an accounting record.
    stage = 'estimate'
    const estimatedBytes = exportable
      .filter((t) => t.file_type !== 'midi')
      .reduce((sum, t) => {
        const paddedMs = (t.duration_ms ?? 0) + Math.max(0, delayMsFor(t))
        return sum + (paddedMs / 1000) * WAV_BYTES_PER_SECOND
      }, 0)

    if (estimatedBytes > TMP_STAGING_BUDGET_BYTES) {
      return NextResponse.json(
        {
          error: 'Export too large',
          detail:
            `This version is about ${Math.round(estimatedBytes / (1024 * 1024))} MB as 24-bit WAV, ` +
            `over the ${Math.round(TMP_STAGING_BUDGET_BYTES / (1024 * 1024))} MB an export can build at once. ` +
            'Download the stems individually, or split them across branches.',
        },
        { status: 413 },
      )
    }

    await mkdir(tmpDir, { recursive: true })

    // Sequential on purpose. Promise.all held every stem's FLAC *and* its
    // decoded 24-bit WAV (~17 MB per stereo minute) in memory at once, which
    // blows the function's heap and /tmp budget on any real project.
    const used = new Set<string>()
    const entries: { name: string; file: string }[] = []

    for (const [index, track] of exportable.entries()) {
      stage = `download:${track.name ?? index}`
      const buffer = await downloadFromR2(track.storage_path as string)

      if (track.file_type === 'midi') {
        // ffmpeg cannot decode MIDI without a soundfont — feeding a .mid to
        // the WAV transcode throws and used to take the whole export down.
        const name = memberName(track, index, used, 'mid')
        const file = path.join(tmpDir, name)
        await writeFile(file, buffer)
        entries.push({ name, file })
        continue
      }

      stage = `transcode:${track.name ?? index}`
      const name = memberName(track, index, used, 'wav')
      const file = path.join(tmpDir, name)
      await flacToWavFile(buffer, file, delayMsFor(track))
      entries.push({ name, file })
    }

    // Stream the zip straight to the client. Writing it to /tmp first meant
    // peak disk was the stems *plus* a full copy of them zipped, which is what
    // produced `ENOSPC` at this stage. The cost is an unknown Content-Length
    // (chunked response, no download progress bar) — worth it.
    stage = 'zip'
    // Level 9 on PCM buys little and costs a lot of the function's CPU budget.
    const archive = archiver('zip', { zlib: { level: 1 } })
    const pending = new Map(entries.map((e) => [e.name, e.file]))

    // Drop each stem the moment the archive has finished reading it, so /tmp
    // drains as the download progresses instead of peaking at the end.
    archive.on('entry', (entry: { name: string }) => {
      const file = pending.get(entry.name)
      if (!file) return
      pending.delete(entry.name)
      rm(file, { force: true }).catch(() => {})
    })
    archive.on('end', dropTmpDir)
    archive.on('close', dropTmpDir)
    archive.on('error', (err) => {
      console.error('[versions/export] archive failed mid-stream', err)
      dropTmpDir()
    })
    // A cancelled download would otherwise leave the archive (and its staged
    // stems) alive until the instance is recycled.
    req.signal.addEventListener('abort', () => {
      archive.destroy()
      dropTmpDir()
    })

    for (const { name, file } of entries) archive.file(file, { name })
    streaming = true
    archive.finalize().catch((err) => {
      console.error('[versions/export] finalize failed', err)
    })

    return new NextResponse(Readable.toWeb(archive as unknown as Readable) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(archiveName),
      },
    })
  } catch (err) {
    console.error(`[versions/export] failed at stage=${stage}`, err)
    return NextResponse.json(
      { error: 'Export failed', stage, detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  } finally {
    if (!streaming) dropTmpDir()
  }
}

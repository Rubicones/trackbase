import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2, streamR2ObjectToFile } from '@/lib/r2'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { flacFileToWavFile } from '@/lib/ffmpeg'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'
import { attachmentDisposition } from '@/lib/contentDisposition'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import archiver from 'archiver'
import { serverErrorResponse } from '@/lib/apiErrors'

// Transcoding every stem is minutes of work for a big project, and the
// function stays alive for as long as the client is still downloading.
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
  const dropTmpDir = () => { rm(tmpDir, { recursive: true, force: true }).catch(() => {}) }
  // Once the producer below owns the temp dir, this handler must not delete it
  // out from under it — cleanup moves onto the producer's own lifecycle.
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

    stage = 'stage-dir'
    await mkdir(tmpDir, { recursive: true })

    // ── Streaming producer ────────────────────────────────────────────────
    // One stem exists on disk at a time. Each is fetched from R2 to a file,
    // transcoded file→file, appended to the archive, and deleted before the
    // next one starts — so peak disk is a single stem regardless of how big
    // the version is, and nothing about the audio touches the heap. This is
    // what removed the old size ceiling: earlier revisions staged every stem
    // (and then a full zip alongside them) inside the function's 512 MB /tmp.
    stage = 'zip'
    // Level 9 on PCM buys little and costs a lot of the function's CPU budget.
    const archive = archiver('zip', { zlib: { level: 1 } })

    /**
     * Append one file and resolve when the archive has finished reading it.
     * `entry` is the signal that the staged file is safe to delete, and
     * awaiting it is also the backpressure: the archive only drains as fast as
     * the client downloads, so a slow connection throttles transcoding instead
     * of letting stems pile up on disk.
     */
    const appendAndWait = (file: string, name: string) =>
      new Promise<void>((resolve, reject) => {
        const onEntry = () => { archive.off('error', onError); resolve() }
        const onError = (err: Error) => { archive.off('entry', onEntry); reject(err) }
        archive.once('entry', onEntry)
        archive.once('error', onError)
        archive.file(file, { name })
      })

    let aborted = false
    // A cancelled download would otherwise leave the producer transcoding
    // stems nobody is waiting for until the function times out.
    req.signal.addEventListener('abort', () => {
      aborted = true
      archive.destroy()
      dropTmpDir()
    })

    const used = new Set<string>()
    const produce = async () => {
      for (const [index, track] of exportable.entries()) {
        if (aborted) return

        const isMidi = track.file_type === 'midi'
        // ffmpeg cannot decode MIDI without a soundfont, so a file_type='midi'
        // row goes out as the raw .mid rather than through the transcode.
        const name = memberName(track, index, used, isMidi ? 'mid' : 'wav')
        const staged = path.join(tmpDir, name)

        if (isMidi) {
          await writeFile(staged, await downloadFromR2(track.storage_path as string))
        } else {
          const flacPath = path.join(tmpDir, `${randomUUID()}.flac`)
          try {
            await streamR2ObjectToFile(track.storage_path as string, flacPath)
            const delayMs = startBarToMs(trackStartBar(track), bpm, timeSignature)
            await flacFileToWavFile(flacPath, staged, delayMs)
          } finally {
            await rm(flacPath, { force: true }).catch(() => {})
          }
        }

        await appendAndWait(staged, name)
        await rm(staged, { force: true }).catch(() => {})
      }

      await archive.finalize()
    }

    streaming = true
    void produce()
      .catch((err) => {
        // Headers are long gone by now, so the only honest signal to the
        // client is a truncated archive. The log is the real record.
        console.error('[versions/export] producer failed mid-stream', err)
        archive.destroy(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(dropTmpDir)

    // No Content-Length: the zip is generated as it is sent, so its size is
    // not knowable up front. Chunked response, no browser progress bar.
    return new NextResponse(Readable.toWeb(archive as unknown as Readable) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(archiveName),
      },
    })
  } catch (err) {
    // `stage` stays in the body — it is a fixed marker from this file, names
    // nothing about the user's data, and is how a failure gets localised
    // (AGENTS.md §4). The free-text `detail` was the underlying ffmpeg / R2 /
    // filesystem error and only ever belonged in the log line above it.
    console.error(`[versions/export] failed at stage=${stage}`)
    return serverErrorResponse('versions/export', err, 'Export failed', 500, { stage })
  } finally {
    if (!streaming) dropTmpDir()
  }
}

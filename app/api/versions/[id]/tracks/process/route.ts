import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { unlink, readFile } from 'fs/promises'
import { createReadStream } from 'fs'
import { supabase } from '@/lib/supabase'
import { streamR2ObjectToFile, uploadToR2, deleteFromR2, r2Key } from '@/lib/r2'
import { audioToFlacFromFile } from '@/lib/ffmpeg'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { logActivity, fmtFileSize } from '@/lib/activity'
import { parseMidiFile, midiDurationMs } from '@/lib/midi'
import { pickTrackIconColor } from '@/lib/trackIcon'
import { markPreviewMixStale } from '@/lib/previewMix'
import { checkBandStorageQuota, storageQuotaError } from '@/lib/bandStorage'

// ── File type helpers (mirrors upload/route.ts) ────────────────────────────────

const AUDIO_FORMAT_MAP: Record<string, 'wav' | 'mp3'> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
}

function isMidiFile(filename: string, mimetype: string): boolean {
  return (
    filename.endsWith('.mid') ||
    filename.endsWith('.midi') ||
    mimetype === 'audio/midi' ||
    mimetype === 'audio/x-midi' ||
    mimetype === 'audio/mid' ||
    mimetype === 'application/x-midi'
  )
}

function isAudioFile(filename: string, mimetype: string): boolean {
  return (
    mimetype in AUDIO_FORMAT_MAP ||
    filename.endsWith('.wav') ||
    filename.endsWith('.mp3')
  )
}

// ── Hash a file by streaming (no full load into memory) ───────────────────────

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: versionId } = await params

  // Verify version and enforce band membership
  const access = await requireBandMemberForVersion(req, versionId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { userId, version } = access

  // Parse body
  let body: {
    tempKey?: string
    originalFilename?: string
    fileSize?: number
    mimetype?: string
    midiStartBar?: number
    startBar?: number
    /** Client-computed recording duration — used as fallback when ffprobe returns 0. */
    durationMs?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    tempKey,
    originalFilename,
    fileSize,
    mimetype = '',
    midiStartBar = 0,
    startBar = 0,
    durationMs: clientDurationMs,
  } = body

  if (!tempKey || typeof tempKey !== 'string') {
    return NextResponse.json({ error: 'tempKey is required' }, { status: 400 })
  }
  if (!originalFilename || typeof originalFilename !== 'string') {
    return NextResponse.json({ error: 'originalFilename is required' }, { status: 400 })
  }

  const filename = originalFilename
  const trackName = filename.replace(/\.[^.]+$/, '')

  // Determine position from existing track count (server-authoritative)
  const { count: trackCount, data: siblingTracks } = await supabase
    .from('tracks')
    .select('icon_color', { count: 'exact' })
    .eq('version_id', versionId)
  const position = trackCount ?? 0
  const iconColor = pickTrackIconColor(
    (siblingTracks ?? []).map(t => t.icon_color),
    position,
  )

  // Determine temp local path for streaming download
  const ext = filename.match(/\.[^.]+$/)?.[0] ?? '.tmp'
  const tempFilePath = join(tmpdir(), `${randomUUID()}${ext}`)

  try {
    // ── Step 1: Download temp file from R2 to disk ─────────────────────────────
    console.log('[process] downloading temp file from R2:', tempKey)
    try {
      await streamR2ObjectToFile(tempKey, tempFilePath)
    } catch (err) {
      console.error('[process] R2 download failed:', err)
      return NextResponse.json(
        { error: 'Failed to retrieve uploaded file from storage' },
        { status: 502 },
      )
    }

    // ── Step 2: Hash file by streaming ─────────────────────────────────────────
    const fileHash = await hashFile(tempFilePath)
    console.log('[process] fileHash:', fileHash)

    // ── Step 3: Dedup check ────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from('tracks')
      .select('storage_path, duration_ms, file_size_bytes')
      .eq('file_hash', fileHash)
      .limit(1)
      .maybeSingle()

    // ── Step 4: Convert / parse ────────────────────────────────────────────────

    if (isMidiFile(filename, mimetype)) {
      // ── MIDI path ────────────────────────────────────────────────────────────
      const midiBuffer = await readFile(tempFilePath)
      let midiData
      try {
        midiData = parseMidiFile(midiBuffer.buffer as ArrayBuffer)
        console.log('[process] MIDI parsed:', midiData.notes.length, 'notes')
      } catch (err) {
        console.error('[process] MIDI parse failed:', err)
        return NextResponse.json(
          { error: 'Failed to parse MIDI file', detail: String(err) },
          { status: 400 },
        )
      }

      const durationMs = Math.round(midiDurationMs(midiData))
      let storagePath: string

      if (existing) {
        storagePath = existing.storage_path
      } else {
        const quota = await checkBandStorageQuota(supabase, access.project.band_id, midiBuffer.byteLength)
        if (!quota.ok) {
          return NextResponse.json(
            { error: storageQuotaError(quota.used, quota.limit), code: 'STORAGE_LIMIT' },
            { status: 413 },
          )
        }
        storagePath = `projects/${version.project_id}/${fileHash}.mid`
        try {
          await uploadToR2(storagePath, midiBuffer, 'audio/midi')
        } catch (err) {
          console.error('[process] R2 MIDI upload failed:', err)
          return NextResponse.json({ error: 'Storage upload failed' }, { status: 500 })
        }
      }

      // Clean up temp R2 object
      deleteFromR2(tempKey).catch(err =>
        console.warn('[process] temp R2 cleanup failed:', err),
      )

      const { data: track, error: trkErr } = await supabase
        .from('tracks')
        .insert({
          version_id: versionId,
          name: trackName,
          original_filename: filename,
          file_hash: fileHash,
          storage_path: storagePath,
          file_size_bytes: fileSize ?? midiBuffer.byteLength,
          duration_ms: durationMs,
          position,
          file_type: 'midi',
          midi_data: midiData,
          midi_start_bar: isNaN(midiStartBar) ? 0 : Math.max(0, midiStartBar),
          start_bar: isNaN(midiStartBar) ? 0 : Math.max(0, midiStartBar),
          icon_color: iconColor,
        })
        .select()
        .single()
      if (trkErr) {
        console.error('[process] MIDI track insert failed:', trkErr)
        return NextResponse.json({ error: 'DB insert failed', detail: trkErr.message }, { status: 500 })
      }

      supabase
        .from('projects').select('id, band_id').eq('id', version.project_id).maybeSingle()
        .then(({ data: proj }) => {
          if (proj) logActivity({
            bandId: proj.band_id, userId, action: 'upload',
            subject: filename, detail: `${midiData.notes.length} notes`,
            projectId: proj.id,
          })
        })

      // MIDI tracks don't affect the audio preview mix — no stale marking needed.
      return NextResponse.json({ track }, { status: 201 })

    } else if (isAudioFile(filename, mimetype)) {
      // ── Audio path ───────────────────────────────────────────────────────────
      const inputFormat = AUDIO_FORMAT_MAP[mimetype] ?? (filename.endsWith('.mp3') ? 'mp3' : 'wav')

      let storagePath: string
      let fileSizeBytes: number
      let audioDurationMs: number = existing?.duration_ms ?? 0

      if (existing) {
        storagePath = existing.storage_path
        fileSizeBytes = existing.file_size_bytes ?? fileSize ?? 0
        // Fill in duration from client if the stored value is missing
        if (!audioDurationMs && clientDurationMs) audioDurationMs = clientDurationMs
        console.log('[process] dedup hit — reusing', storagePath)
      } else {
        let flacBuffer: Buffer
        try {
          console.log('[process] converting to FLAC from file:', tempFilePath)
          const result = await audioToFlacFromFile(tempFilePath, inputFormat)
          flacBuffer = result.flac
          // ffprobe can return 0 for browser-recorded WAV (missing duration header);
          // fall back to the client-reported duration in that case.
          audioDurationMs = result.durationMs || clientDurationMs || 0
          console.log('[process] FLAC done, size:', flacBuffer.byteLength, 'duration:', audioDurationMs, 'ms')
        } catch (err) {
          console.error('[process] ffmpeg conversion failed:', err)
          return NextResponse.json(
            { error: 'Audio conversion failed', detail: String(err) },
            { status: 500 },
          )
        }

        const quota = await checkBandStorageQuota(supabase, access.project.band_id, flacBuffer.byteLength)
        if (!quota.ok) {
          return NextResponse.json(
            { error: storageQuotaError(quota.used, quota.limit), code: 'STORAGE_LIMIT' },
            { status: 413 },
          )
        }

        storagePath = r2Key(version.project_id, fileHash)
        try {
          await uploadToR2(storagePath, flacBuffer)
        } catch (err) {
          console.error('[process] R2 upload failed:', err)
          return NextResponse.json({ error: 'Storage upload failed', detail: String(err) }, { status: 500 })
        }
        fileSizeBytes = flacBuffer.byteLength
      }

      // Clean up temp R2 object
      deleteFromR2(tempKey).catch(err =>
        console.warn('[process] temp R2 cleanup failed:', err),
      )

      const audioStartBar = isNaN(startBar) ? 0 : Math.max(0, startBar)
      const { data: track, error: trkErr } = await supabase
        .from('tracks')
        .insert({
          version_id: versionId,
          name: trackName,
          original_filename: filename,
          file_hash: fileHash,
          storage_path: storagePath,
          file_size_bytes: fileSizeBytes,
          duration_ms: audioDurationMs || null,
          position,
          file_type: 'audio',
          start_bar: audioStartBar,
          icon_color: iconColor,
        })
        .select()
        .single()
      if (trkErr) {
        console.error('[process] track insert failed:', trkErr)
        return NextResponse.json({ error: 'DB insert failed', detail: trkErr.message }, { status: 500 })
      }

      supabase
        .from('projects').select('id, band_id').eq('id', version.project_id).maybeSingle()
        .then(({ data: proj }) => {
          if (proj) logActivity({
            bandId: proj.band_id, userId, action: 'upload',
            subject: filename, detail: fmtFileSize(fileSizeBytes),
            projectId: proj.id,
          })
        })

      // Adding an audio track to the main version changes the rendered mix.
      // Check asynchronously to avoid blocking the response.
      supabase
        .from('versions')
        .select('type')
        .eq('id', versionId)
        .single()
        .then(({ data: ver }) => {
          if (ver?.type === 'main') {
            void markPreviewMixStale(version.project_id)
          }
        })

      return NextResponse.json({ track }, { status: 201 })

    } else {
      return NextResponse.json(
        { error: `Unsupported file type: "${mimetype}". Allowed: WAV, MP3, MIDI.` },
        { status: 400 },
      )
    }
  } finally {
    // Always clean up the local temp file
    await unlink(tempFilePath).catch(() => {})
  }
}

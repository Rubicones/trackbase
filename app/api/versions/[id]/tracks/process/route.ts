import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlink, writeFile } from 'fs/promises'
import { supabase } from '@/lib/supabase'
import { serverErrorResponse } from '@/lib/apiErrors'
import {
  uploadToR2, deleteFromR2, r2Key, headR2Object, downloadFromR2,
  getR2ObjectStream, readR2ObjectHead, sha256OfR2Object, uploadStreamToR2,
} from '@/lib/r2'
import { AudioTooLongError, encodeFlacStream, probeAudioFormat } from '@/lib/ffmpeg'
import {
  MAX_TRACK_UPLOAD_BYTES, MAX_TRACK_DURATION_MS, MAX_MIDI_UPLOAD_BYTES,
  tooLargeMessage, tooLongMessage,
} from '@/lib/uploadLimits'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { logActivity, fmtFileSize } from '@/lib/activity'
import { parseMidiFile, midiDurationMs } from '@/lib/midi'
import { pickTrackIconColor } from '@/lib/trackIcon'
import { markPreviewMixStale } from '@/lib/previewMix'
import { storageRefusal } from '@/lib/planGuards'
import { isValidTempKey } from '@/lib/r2TempKey'
import { findBandTrackByHash, deleteObjectIfUnreferenced } from '@/lib/trackDedup'

// Hash pass + streaming conversion of a long hi-res upload can take a while.
export const maxDuration = 300

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Bytes of the upload's head handed to ffprobe — enough for any sane header (incl. big ID3 art). */
const PROBE_HEAD_BYTES = 16 * 1024 * 1024

/**
 * Stream parameters (rate / channels / bit depth) of an upload, from its first
 * PROBE_HEAD_BYTES only — the full file never touches /tmp. The duration this
 * returns is an estimate for a file larger than the head (ffprobe sees a
 * truncated file); the exact length is counted during the encode.
 */
async function probeR2AudioHead(key: string, size: number) {
  const headPath = join(tmpdir(), `${randomUUID()}.probe`)
  try {
    await writeFile(headPath, await readR2ObjectHead(key, Math.min(size, PROBE_HEAD_BYTES)))
    return await probeAudioFormat(headPath)
  } finally {
    await unlink(headPath).catch(() => {})
  }
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
    /**
     * Declared by the client and deliberately UNUSED. The object is already in
     * R2 by the time this route runs, so the only number that means anything is
     * the byte length we read back. Kept in the type as documentation of what
     * the browser still sends — do not wire it up to `file_size_bytes` or to a
     * quota check.
     */
    fileSize?: number
    mimetype?: string
    midiStartBar?: number
    startBar?: number
    /** Client-computed recording duration — only a fallback for dedup hits with no stored duration. */
    durationMs?: number
    /**
     * Optional SHA-256 (hex) of the file as the browser read it. When present
     * it must match what R2 holds, or the upload was damaged in transit and is
     * refused. (Sent by the multipart uploader.)
     */
    sha256?: string
    /** Preserve metadata when replacing an existing track. */
    name?: string
    position?: number
    iconColor?: string
    displayName?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    tempKey,
    originalFilename,
    mimetype = '',
    midiStartBar = 0,
    startBar = 0,
    durationMs: clientDurationMs,
    name: requestedName,
    position: requestedPosition,
    iconColor: requestedIconColor,
    displayName: requestedDisplayName,
    sha256: expectedSha256,
  } = body

  if (!tempKey || typeof tempKey !== 'string') {
    return NextResponse.json({ error: 'tempKey is required' }, { status: 400 })
  }
  if (!isValidTempKey(tempKey, 'track')) {
    return NextResponse.json({ error: 'Invalid upload key' }, { status: 400 })
  }
  if (!originalFilename || typeof originalFilename !== 'string') {
    return NextResponse.json({ error: 'originalFilename is required' }, { status: 400 })
  }

  const filename = originalFilename
  const trackName =
    typeof requestedName === 'string' && requestedName.trim()
      ? requestedName.trim()
      : filename.replace(/\.[^.]+$/, '')

  // Determine position from existing track count (server-authoritative) unless replacing.
  const { count: trackCount, data: siblingTracks } = await supabase
    .from('tracks')
    .select('icon_color', { count: 'exact' })
    .eq('version_id', versionId)
  const position =
    typeof requestedPosition === 'number' && requestedPosition >= 0
      ? requestedPosition
      : (trackCount ?? 0)
  const iconColor =
    typeof requestedIconColor === 'string' && requestedIconColor.trim()
      ? requestedIconColor.trim()
      : pickTrackIconColor(
          (siblingTracks ?? []).map(t => t.icon_color),
          position,
        )
  const displayName =
    typeof requestedDisplayName === 'string' && requestedDisplayName.trim()
      ? requestedDisplayName.trim()
      : null

  /** Refuse an upload and drop its temp object — nothing else will ever read it. */
  const reject = (error: string, status: number) => {
    deleteFromR2(tempKey).catch(err => console.warn('[process] temp R2 cleanup failed:', err))
    return NextResponse.json({ error }, { status })
  }

  try {
    // ── Step 0: Real size gate ─────────────────────────────────────────────────
    // The presigned PUT doesn't pin Content-Length, so the size presign
    // checked was only what the browser declared. Check what R2 holds before
    // pulling a byte of it.
    let stored: { size: number } | null
    try {
      stored = await headR2Object(tempKey)
    } catch (err) {
      console.error('[process] R2 head failed:', err)
      return NextResponse.json({ error: 'Failed to retrieve uploaded file from storage' }, { status: 502 })
    }
    if (!stored) {
      return NextResponse.json({ error: 'Uploaded file not found — please upload it again' }, { status: 404 })
    }
    if (stored.size > MAX_TRACK_UPLOAD_BYTES) {
      return reject(tooLargeMessage(), 413)
    }

    const isMidi = isMidiFile(filename, mimetype)
    if (isMidi && stored.size > MAX_MIDI_UPLOAD_BYTES) {
      return reject(tooLargeMessage(MAX_MIDI_UPLOAD_BYTES), 413)
    }

    // ── Step 1–2: Hash, streamed straight from R2 (nothing on disk) ───────────
    // Hashing first (one extra read) means a dedup hit skips the conversion
    // entirely, and the final object key is known before anything is written.
    let fileHash: string
    let midiBuffer: Buffer | null = null
    try {
      if (isMidi) {
        midiBuffer = await downloadFromR2(tempKey)
        fileHash = createHash('sha256').update(midiBuffer).digest('hex')
      } else {
        const h = await sha256OfR2Object(tempKey)
        if (h.bytes !== stored.size) throw new Error(`temp object changed size ${stored.size} → ${h.bytes}`)
        fileHash = h.sha256
      }
    } catch (err) {
      console.error('[process] R2 read failed:', err)
      return NextResponse.json({ error: 'Failed to retrieve uploaded file from storage' }, { status: 502 })
    }
    console.log('[process] fileHash:', fileHash)
    if (typeof expectedSha256 === 'string' && expectedSha256.toLowerCase() !== fileHash) {
      return reject('The upload was damaged in transit — please upload the file again.', 422)
    }

    // ── Step 3: Dedup check, scoped to THIS band ───────────────────────────────
    //
    // Band-scoped, not global. A global match skipped `storageRefusal()` for
    // any file that existed anywhere in the database, so a band at its ceiling
    // could keep adding rows that were then counted against it — and it left
    // this band's `storage_path` pointing at another band's object. See
    // `lib/trackDedup.ts`. The cost is one stored copy per band, which is
    // right: storage is never pooled here.
    const existing = await findBandTrackByHash(access.project.band_id, fileHash)

    // ── Step 4: Convert / parse ────────────────────────────────────────────────

    if (isMidi && midiBuffer) {
      // ── MIDI path ────────────────────────────────────────────────────────────
      let midiData
      try {
        midiData = parseMidiFile(midiBuffer.buffer as ArrayBuffer)
        console.log('[process] MIDI parsed:', midiData.notes.length, 'notes')
      } catch (err) {
        console.error('[process] MIDI parse failed:', err)
        return serverErrorResponse('versions/tracks/process', err, 'Could not read that MIDI file', 400)
      }

      const durationMs = Math.round(midiDurationMs(midiData))
      let storagePath: string

      if (existing) {
        storagePath = existing.storage_path
      } else {
        // Per-band storage ceiling, resolved from the band owner's plan plus
        // this band's extra_storage addons. Never pooled across bands.
        const overQuota = await storageRefusal(access.project.band_id, midiBuffer.byteLength)
        if (overQuota) return overQuota
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
          ...(displayName ? { display_name: displayName } : {}),
          original_filename: filename,
          file_hash: fileHash,
          storage_path: storagePath,
          // Always the real byte count of the object we stored, never the
          // client's `fileSize`. The quota check above uses the same number, so
          // a declared size could otherwise be checked against one value and
          // recorded as another — understating the band's usage permanently.
          file_size_bytes: midiBuffer.byteLength,
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
        return serverErrorResponse('versions/tracks/process', trkErr, 'Could not save the track')
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
      // Stored at the upload's native sample rate / bit depth (lib/ffmpeg.ts).

      let storagePath: string
      let fileSizeBytes: number
      let audioDurationMs: number = existing?.duration_ms ?? 0

      if (existing) {
        storagePath = existing.storage_path
        // Dedup hit: inherit the stored count. Falling back to the client's
        // `fileSize` here would let a caller claim an arbitrary size for a row
        // that shares an existing hash, so an unknown size counts as 0 instead.
        fileSizeBytes = existing.file_size_bytes ?? 0
        // Fill in duration from client if the stored value is missing
        if (!audioDurationMs && clientDurationMs) audioDurationMs = clientDurationMs
        // Same bytes as an existing track, but that one may predate the length
        // limit — the limit is about what the mixer can hold, so apply it here too.
        if (audioDurationMs > MAX_TRACK_DURATION_MS) return reject(tooLongMessage(), 413)
        console.log('[process] dedup hit — reusing', storagePath)
      } else {
        // A band already at its ceiling is refused before the conversion runs.
        const alreadyFull = await storageRefusal(access.project.band_id, 0)
        if (alreadyFull) return alreadyFull

        // Stream parameters from the first few MB. The duration here is only
        // an estimate (exact for files under the probe size, low for larger
        // ones), so it can refuse early but never wrongly.
        const probe = await probeR2AudioHead(tempKey, stored.size)
        if (!probe) return reject('Could not read that audio file', 400)
        if (probe.durationMs > MAX_TRACK_DURATION_MS) return reject(tooLongMessage(), 413)
        const { format } = probe

        // ── Convert: R2 temp → ffmpeg decode → count → ffmpeg FLAC → R2 ──────
        // No /tmp, constant memory; the object appears under storagePath only
        // if every step succeeded (uploadStreamToR2 aborts otherwise).
        storagePath = r2Key(version.project_id, fileHash)
        let frames: number
        try {
          const { body: source } = await getR2ObjectStream(tempKey)
          const enc = encodeFlacStream({
            source,
            decodeArgs: ['-i', 'pipe:0'],
            format,
            maxFrames: Math.floor((MAX_TRACK_DURATION_MS / 1000) * format.sampleRate),
          })
          const { bytes } = await uploadStreamToR2(storagePath, enc.stream, 'audio/flac', {
            finalizeHead: enc.patchStreamInfo,
          })
          fileSizeBytes = bytes
          frames = enc.frames()
        } catch (err) {
          if (err instanceof AudioTooLongError) return reject(tooLongMessage(), 413)
          console.error('[process] streaming conversion failed:', err)
          return serverErrorResponse('versions/tracks/process', err, 'Could not convert that audio file')
        }
        // Exact: counted samples at the stored rate.
        audioDurationMs = Math.round((frames / format.sampleRate) * 1000)
        console.log('[process] FLAC stored, size:', fileSizeBytes, 'duration:', audioDurationMs, 'ms', format)

        // Per-band storage ceiling, resolved from the band owner's plan plus
        // this band's extra_storage addons. Never pooled across bands. The
        // FLAC size is only known now, so on refusal undo the write.
        const overQuota = await storageRefusal(access.project.band_id, fileSizeBytes)
        if (overQuota) {
          await deleteObjectIfUnreferenced(storagePath)
          deleteFromR2(tempKey).catch(() => {})
          return overQuota
        }
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
          ...(displayName ? { display_name: displayName } : {}),
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
        return serverErrorResponse('versions/tracks/process', trkErr, 'Could not save the track')
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
    // Nothing on local disk to clean up: audio streams R2 → ffmpeg → R2, and
    // the probe head is removed by probeR2AudioHead itself.
  }
}

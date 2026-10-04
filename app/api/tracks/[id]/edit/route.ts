import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'
import { getR2ObjectStream, readR2ObjectHead, r2Key, uploadStreamToR2 } from '@/lib/r2'
import { parseFlacStreamInfo, renderEditedFlacStream, type RenderEditSegment } from '@/lib/ffmpeg'
import { deleteObjectIfUnreferenced } from '@/lib/trackDedup'
import { MAX_TRACK_DURATION_MS, tooLongMessage } from '@/lib/uploadLimits'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { logActivity, trackActivityLabel } from '@/lib/activity'
import { markPreviewMixStale } from '@/lib/previewMix'
import { assertBandFeature, limitRefusalResponse, storageRefusal } from '@/lib/planGuards'
import { barDurationSecFor, contentBarsFor } from '@/lib/trackEdit'

// Streaming render + upload of a long hi-res track.
export const maxDuration = 300

const MAX_SEGMENTS = 256
const MAX_CLIPS_PER_SEGMENT = 512
const MAX_BAR = 100_000
/** Finest bar subdivision accepted from clients (matches trackEdit MIN_EDIT_BAR_UNIT). */
const MIN_BAR_UNIT = 0.25

function isQuarterBarMultiple(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n * 4 - Math.round(n * 4)) < 1e-6
}

function parseBarNumber(raw: unknown, min: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < min - 1e-9 || raw > MAX_BAR) return null
  if (!isQuarterBarMultiple(raw)) return null
  return Math.round(raw * 4) / 4
}

function parseSegments(raw: unknown): RenderEditSegment[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SEGMENTS) return null
  const segments: RenderEditSegment[] = []
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) return null
    const { startBar, clips } = s as { startBar?: unknown; clips?: unknown }
    const parsedStart = parseBarNumber(startBar, 0)
    if (parsedStart == null) return null
    if (!Array.isArray(clips) || clips.length === 0 || clips.length > MAX_CLIPS_PER_SEGMENT) return null
    const parsedClips = []
    for (const c of clips) {
      if (typeof c !== 'object' || c === null) return null
      const { srcBar, lenBars } = c as { srcBar?: unknown; lenBars?: unknown }
      const parsedSrc = parseBarNumber(srcBar, 0)
      const parsedLen = parseBarNumber(lenBars, MIN_BAR_UNIT)
      if (parsedSrc == null || parsedLen == null) return null
      parsedClips.push({ srcBar: parsedSrc, lenBars: parsedLen })
    }
    segments.push({ startBar: parsedStart, clips: parsedClips })
  }
  // Segments must not overlap on the timeline.
  const sorted = [...segments].sort((a, b) => a.startBar - b.startBar)
  let cursor = 0
  for (const seg of sorted) {
    if (seg.startBar < cursor - 1e-9) return null
    cursor = seg.startBar + seg.clips.reduce((sum, c) => sum + c.lenBars, 0)
    if (cursor > MAX_BAR) return null
  }
  return sorted
}

// POST /api/tracks/[id]/edit
// Renders a non-destructive edit session into a new audio file, uploads it to
// R2 and repoints the track at it (start_bar folded into the file as silence).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: trackId } = await params

  const access = await requireBandMemberForTrack(req, trackId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { userId, project, track: trackRef } = access

  let body: { segments?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const segments = parseSegments(body.segments)
  if (!segments) {
    return NextResponse.json({ error: 'Invalid segments payload' }, { status: 400 })
  }

  // Gated feature. Hiding the button is not enforcement — this endpoint does
  // the work, so it is where the entitlement is verified. Resolved from the
  // BAND's plan, so every member of a paid band can use it, not just the owner.
  try {
    await assertBandFeature(project.band_id, 'track_edit')
  } catch (err) {
    const refusal = limitRefusalResponse(err)
    if (refusal) return refusal
    throw err
  }

  const { data: track, error: trackErr } = await supabase
    .from('tracks')
    .select('id, version_id, name, display_name, original_filename, storage_path, file_type, duration_ms')
    .eq('id', trackId)
    .single()
  if (trackErr || !track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 })
  }
  if (track.file_type === 'midi') {
    return NextResponse.json({ error: 'Only audio tracks can be edited' }, { status: 400 })
  }

  const { data: projectRow } = await supabase
    .from('projects')
    .select('bpm, time_signature')
    .eq('id', project.id)
    .maybeSingle()
  const bpm = projectRow?.bpm ?? 120
  const timeSignature = projectRow?.time_signature ?? '4/4'
  const barDurSec = barDurationSecFor(bpm, timeSignature)

  try {
    // ── Validate clip ranges against actual source length ─────────────────────
    // (renderEditedFlac clamps clips to the probed source duration; this is a
    // sanity bound against absurd payloads when we know the stored duration)
    const sourceDurSec = (track.duration_ms ?? 0) / 1000
    if (sourceDurSec > 0) {
      const contentBars = contentBarsFor(sourceDurSec, barDurSec)
      for (const seg of segments) {
        for (const clip of seg.clips) {
          if (clip.srcBar + clip.lenBars > contentBars + 1) {
            return NextResponse.json(
              { error: 'Clip range exceeds source audio length' },
              { status: 400 },
            )
          }
        }
      }
    }

    // ── Render: R2 source → ffmpeg (stdin) → count → FLAC → R2 ───────────────
    // Streamed end to end — no /tmp, no buffers. The key is content-addressed
    // by the edit itself (source object + segments + tempo), so the same edit
    // of the same source maps to the same object; the rendered bytes are
    // deterministic, so an overwrite is identical.
    const fileHash = createHash('sha256')
      .update(JSON.stringify({ v: 'edit-v2', src: track.storage_path, segments, barDurSec }))
      .digest('hex')
    const storagePath = r2Key(project.id, fileHash)

    const alreadyFull = await storageRefusal(project.band_id, 0)
    if (alreadyFull) return alreadyFull

    let flacBytes: number
    let durationMs: number
    try {
      const srcInfo = parseFlacStreamInfo(await readR2ObjectHead(track.storage_path, 42))
      if (!srcInfo) {
        return NextResponse.json({ error: 'Source audio could not be read' }, { status: 422 })
      }
      const { body: source } = await getR2ObjectStream(track.storage_path)
      const { encoder, durationMs: timelineMs } = renderEditedFlacStream(source, srcInfo, segments, barDurSec)
      if (timelineMs > MAX_TRACK_DURATION_MS) {
        source.destroy()
        return NextResponse.json({ error: tooLongMessage() }, { status: 413 })
      }
      const { bytes } = await uploadStreamToR2(storagePath, encoder.stream, 'audio/flac', {
        finalizeHead: encoder.patchStreamInfo,
      })
      flacBytes = bytes
      durationMs = Math.round((encoder.frames() / srcInfo.sampleRate) * 1000)
    } catch (err) {
      console.error('[track-edit] render failed:', err)
      return NextResponse.json(
        { error: 'Could not render the edited audio' },
        { status: 500 },
      )
    }

    // ── Quota ──────────────────────────────────────────────────────────────────
    // Per-band storage ceiling, resolved from the band owner's plan plus this
    // band's extra_storage addons. Never pooled across bands. The size is only
    // known after the streamed write, so a refusal undoes it.
    const overQuota = await storageRefusal(project.band_id, flacBytes)
    if (overQuota) {
      await deleteObjectIfUnreferenced(storagePath)
      return overQuota
    }

    // ── Repoint the track at the rendered file ─────────────────────────────────
    // start_bar resets to 0: any offset is now baked into the file as silence.
    const { data: updatedTrack, error: updErr } = await supabase
      .from('tracks')
      .update({
        storage_path: storagePath,
        file_hash: fileHash,
        duration_ms: durationMs,
        file_size_bytes: flacBytes,
        start_bar: 0,
        midi_start_bar: 0,
      })
      .eq('id', trackId)
      .select()
      .single()
    if (updErr) {
      console.error('[track-edit] track update failed:', updErr)
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
    }

    // Editing an audio track on main changes the rendered mix.
    const { data: version } = await supabase
      .from('versions')
      .select('type')
      .eq('id', trackRef.version_id)
      .single()
    if (version?.type === 'main') {
      void markPreviewMixStale(project.id)
    }

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'upload',
      subject: trackActivityLabel(track),
      detail: 'Edited in mixer',
      projectId: project.id,
    })

    return NextResponse.json({ track: updatedTrack })
  } catch (err) {
    console.error('[track-edit]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'
import { uploadToR2, r2MidiKey } from '@/lib/r2'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { storageRefusal } from '@/lib/planGuards'

/** Same ceiling as every other upload path: presign, process, resources. */
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

/**
 * PUT /api/tracks/[id]/midi-upload
 * Receives a raw .mid file (FormData) and uploads it to R2.
 * Called by the PianoRollEditor save flow after serializing notes.
 *
 * ── Storage accounting ──────────────────────────────────────────────────────
 * This route writes to R2, so it carries the same three obligations as every
 * other upload path, all of which it was missing:
 *
 *   · a size cap, so one request cannot stream an unbounded object into the
 *     bucket;
 *   · `storageRefusal()` against the band's resolved ceiling BEFORE the write,
 *     so an over-quota band is refused rather than billed;
 *   · the real byte count written onto the track row. `file_size_bytes` is
 *     excluded from the PATCH allow-list on purpose (see
 *     `app/api/tracks/[id]/route.ts` — a writable one lets a member drive
 *     their band's measured usage below zero), so the rule is that the route
 *     which produced the bytes is the route that records them. This one
 *     produced them, and until it recorded them every MIDI saved from the
 *     piano roll was invisible to `getBandStorageUsed()` and to every usage
 *     surface built on it.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForTrack(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    // Verify track is MIDI type
    const { data: track, error } = await supabase
      .from('tracks')
      .select('id, file_type, version_id')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    if (track.file_type !== 'midi') return NextResponse.json({ error: 'Not a MIDI track' }, { status: 400 })

    // Get the version's project_id for path construction
    const { data: version } = await supabase
      .from('versions')
      .select('project_id')
      .eq('id', track.version_id)
      .single()
    if (!version) return NextResponse.json({ error: 'Version not found' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    if (buffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` },
        { status: 413 },
      )
    }

    // Per-band storage ceiling, resolved from the band owner's plan plus this
    // band's extra_storage addons. Never pooled across bands. Measured on the
    // buffer we actually hold, not on anything the form declared.
    const overQuota = await storageRefusal(access.project.band_id, buffer.byteLength)
    if (overQuota) return overQuota

    // ── The key is derived, never accepted ──────────────────────────────────
    // This route used to write to whatever `storage_path` the form carried.
    // Band membership authorises the request; it says nothing about the key —
    // so any member could name another band's object and overwrite it. The
    // caller no longer has a say: the project comes from the track row and the
    // filename from a hash of the bytes we just received, which is the same
    // value the client would have computed for an honest request.
    const hash = createHash('sha256').update(buffer).digest('hex')
    const storagePath = r2MidiKey(version.project_id, hash)

    await uploadToR2(storagePath, buffer, 'audio/midi')

    // ── The row is repointed HERE, not by the client ────────────────────────
    // `file_hash`, `storage_path` and `file_size_bytes` are all written by this
    // route, from the buffer it just stored, because this route is the one that
    // produced them. None of the three is in the PATCH allow-list
    // (`app/api/tracks/[id]/route.ts`) — `file_hash` in particular is the key
    // `getBandStorageUsed()` deduplicates on, so a client that could set it
    // could collide two tracks onto one hash and make the second stop counting.
    //
    // This write is therefore FATAL on failure, where the byte count alone used
    // to be logged and stepped over. The client can no longer repair the row
    // afterwards, so a skipped write would leave the track pointing at the
    // previous object and silently lose the save. The uploaded object is
    // orphaned in R2 in that case, which is the cheaper of the two failures.
    const { error: repointErr } = await supabase
      .from('tracks')
      .update({
        file_hash: hash,
        storage_path: storagePath,
        file_size_bytes: buffer.byteLength,
      })
      .eq('id', id)
    if (repointErr) {
      console.error('[midi-upload] track repoint failed:', repointErr)
      return NextResponse.json({ error: 'Could not save the MIDI file' }, { status: 500 })
    }

    // Returned for the client's own state, not for it to write back: the row
    // already points at these values.
    return NextResponse.json({ ok: true, storage_path: storagePath, file_hash: hash })
  } catch (err) {
    console.error('[midi-upload] error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

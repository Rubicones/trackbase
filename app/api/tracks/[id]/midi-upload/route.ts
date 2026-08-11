import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'
import { uploadToR2, r2MidiKey } from '@/lib/r2'
import { requireBandMemberForTrack } from '@/lib/supabase/server'

/**
 * PUT /api/tracks/[id]/midi-upload
 * Receives a raw .mid file (FormData) and uploads it to R2.
 * Called by the PianoRollEditor save flow after serializing notes.
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

    // Returned so the client patches the row with the key we actually wrote,
    // rather than the one it guessed.
    return NextResponse.json({ ok: true, storage_path: storagePath, file_hash: hash })
  } catch (err) {
    console.error('[midi-upload] error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

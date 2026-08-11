import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { logActivity, trackActivityLabel } from '@/lib/activity'
import { markPreviewMixStale } from '@/lib/previewMix'
import { sanitizeTrackStartBarForServer } from '@/lib/trackMerge'
import { isValidProjectObjectKey, isValidFileHash } from '@/lib/r2'

/** Returns true if the given version_id belongs to the main version of its project. */
async function isMainVersion(versionId: string): Promise<boolean> {
  const { data } = await supabase
    .from('versions')
    .select('type')
    .eq('id', versionId)
    .single()
  return data?.type === 'main'
}

// DELETE /api/tracks/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForTrack(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project, track } = access

    const { data: trackRow } = await supabase
      .from('tracks')
      .select('name, display_name, original_filename, file_type')
      .eq('id', id)
      .single()

    const { error } = await supabase.from('tracks').delete().eq('id', id)
    if (error) throw error

    // If the deleted track was on main and was an audio track, the rendered mix changed.
    if (trackRow?.file_type !== 'midi' && await isMainVersion(track.version_id)) {
      void markPreviewMixStale(project.id)
    }

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'track_remove',
      subject: trackActivityLabel(trackRow ?? {}),
      projectId: project.id,
    })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/tracks/[id]
// Supports: file_hash, storage_path, midi_data updates (for MIDI save flow)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForTrack(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { project, track } = access

    const body = await req.json()

    // ⚠ `file_size_bytes` is deliberately NOT here. It is the storage
    // accounting value: `getBandStorageUsed()` sums it, so a writable one lets
    // a member set a negative size and drive their band's measured usage below
    // zero, which lifts the storage ceiling entirely. Byte counts are only ever
    // written by the paths that actually produced the bytes (tracks/process,
    // tracks/upload, tracks/edit), from the buffer they just hashed.
    const allowed = ['file_hash', 'storage_path', 'midi_data', 'duration_ms', 'midi_start_bar', 'start_bar']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }
    // ── The two fields that point at storage ────────────────────────────────
    // `storage_path` is an R2 object key and `file_hash` is what dedup matches
    // on, so neither may be free text. An arbitrary key lets a member of one
    // band point a row at another band's object and read it back through
    // `/api/tracks/[id]/stream`, which authorises the *track*, not the key.
    // Both are constrained to the canonical `projects/{thisProject}/{sha256}`
    // shape — the only shape the upload paths ever produce.
    if ('storage_path' in updates && !isValidProjectObjectKey(updates.storage_path, project.id)) {
      return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
    }
    if ('file_hash' in updates && !isValidFileHash(updates.file_hash)) {
      return NextResponse.json({ error: 'Invalid file hash' }, { status: 400 })
    }

    if ('start_bar' in updates) {
      updates.start_bar = sanitizeTrackStartBarForServer(Number(updates.start_bar) || 0)
      updates.midi_start_bar = updates.start_bar
    } else if ('midi_start_bar' in updates) {
      const bar = sanitizeTrackStartBarForServer(Number(updates.midi_start_bar) || 0)
      updates.midi_start_bar = bar
      updates.start_bar = bar
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Fetch track file_type before updating (preview mix stale marking).
    const { data: existingTrack } = await supabase
      .from('tracks')
      .select('file_type')
      .eq('id', id)
      .single()

    const { data: updatedTrack, error } = await supabase
      .from('tracks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    // start_bar or file_hash changes on a main audio track affect the rendered mix.
    const affectsAudio = existingTrack?.file_type !== 'midi'
    const affectsRendering = 'start_bar' in updates || 'midi_start_bar' in updates || 'file_hash' in updates
    if (affectsAudio && affectsRendering && await isMainVersion(track.version_id)) {
      void markPreviewMixStale(project.id)
    }

    return NextResponse.json({ track: updatedTrack })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

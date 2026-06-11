import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { uploadToR2 } from '@/lib/r2'

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

    // Verify track exists and is MIDI
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
    const storagePath = formData.get('storage_path') as string | null

    if (!file || !storagePath) {
      return NextResponse.json({ error: 'file and storage_path required' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    await uploadToR2(storagePath, buffer, 'audio/midi')

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[midi-upload] error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { parseMidiFile } from '@/lib/midi'

// GET /api/tracks/[id]/midi
// Returns cached midi_data, or fetches + parses from R2 and caches it.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: track, error } = await supabase
      .from('tracks')
      .select('id, storage_path, file_type, midi_data')
      .eq('id', id)
      .single()
    if (error) throw error

    if (track.file_type !== 'midi') {
      return NextResponse.json({ error: 'Not a MIDI track' }, { status: 400 })
    }

    // Return cached data if available
    if (track.midi_data) {
      return NextResponse.json({ midi_data: track.midi_data })
    }

    // Fetch raw MIDI from R2, parse, and cache
    const buffer = await downloadFromR2(track.storage_path)
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
    const midiData = parseMidiFile(arrayBuffer)

    // Cache in DB (fire and forget errors)
    await supabase
      .from('tracks')
      .update({ midi_data: midiData })
      .eq('id', id)

    return NextResponse.json({ midi_data: midiData })
  } catch (err) {
    console.error('[midi] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

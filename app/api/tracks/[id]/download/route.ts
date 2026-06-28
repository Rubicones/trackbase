import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { flacToWav } from '@/lib/ffmpeg'
import { requireBandMemberForTrack } from '@/lib/supabase/server'

// GET /api/tracks/[id]/download
// Audio: fetches FLAC from R2, converts to WAV. MIDI: returns raw .mid from R2.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: trackId } = await params

    const access = await requireBandMemberForTrack(req, trackId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { data: track, error } = await supabase
      .from('tracks')
      .select('storage_path, original_filename, name, file_type')
      .eq('id', trackId)
      .single()
    if (error) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const baseName = (track.original_filename ?? track.name).replace(/\.[^/.]+$/, '')

    if (track.file_type === 'midi') {
      const midiBuffer = await downloadFromR2(track.storage_path)
      const filename = `${baseName}.mid`

      return new NextResponse(new Uint8Array(midiBuffer), {
        headers: {
          'Content-Type': 'audio/midi',
          'Content-Length': String(midiBuffer.byteLength),
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    const flacBuffer = await downloadFromR2(track.storage_path)
    const wavBuffer = await flacToWav(flacBuffer)

    const filename = `${baseName}.wav`

    return new NextResponse(new Uint8Array(wavBuffer), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wavBuffer.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('[download]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

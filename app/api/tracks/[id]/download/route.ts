import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { flacToWav } from '@/lib/ffmpeg'

// GET /api/tracks/[id]/download
// Fetches the FLAC from R2, converts to WAV, returns as a downloadable attachment.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: trackId } = await params

    const { data: track, error } = await supabase
      .from('tracks')
      .select('storage_path, original_filename, name')
      .eq('id', trackId)
      .single()
    if (error) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const flacBuffer = await downloadFromR2(track.storage_path)
    const wavBuffer = await flacToWav(flacBuffer)

    const baseName = (track.original_filename ?? track.name).replace(/\.[^/.]+$/, '')
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

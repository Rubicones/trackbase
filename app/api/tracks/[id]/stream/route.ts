import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'

// GET /api/tracks/[id]/stream
// Streams the FLAC file for a track.
// Supports Range requests for seek support in Web Audio / <audio>.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: trackId } = await params

    const { data: track, error } = await supabase
      .from('tracks')
      .select('storage_path, file_size_bytes, name')
      .eq('id', trackId)
      .single()
    if (error) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const buffer = await downloadFromR2(track.storage_path)
    const totalSize = buffer.byteLength

    const rangeHeader = req.headers.get('range')

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : totalSize - 1
      const chunkSize = end - start + 1

      return new NextResponse(new Uint8Array(buffer.subarray(start, end + 1)), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'audio/flac',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'audio/flac',
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

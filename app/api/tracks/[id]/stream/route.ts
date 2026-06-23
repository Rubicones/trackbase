import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { requireBandMemberForTrack } from '@/lib/supabase/server'

/** Auth-gated audio — must not be cached as public at CDN/browser. */
const STREAM_CACHE_CONTROL = 'private, no-store'

// GET /api/tracks/[id]/stream
// Streams the FLAC file for a track.
// Supports Range requests for seek support in Web Audio / <audio>.
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
          'Cache-Control': STREAM_CACHE_CONTROL,
          Vary: 'Cookie',
        },
      })
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'audio/flac',
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': STREAM_CACHE_CONTROL,
        Vary: 'Cookie',
      },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

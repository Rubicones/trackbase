import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getPresignedDownloadUrl } from '@/lib/r2'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { r2ObjectResponse } from '@/lib/trackDelivery'

/** Auth-gated audio — must not be cached as public at CDN/browser. */
const STREAM_CACHE_CONTROL = 'private, no-store'

/** Lifetime of a signed playback URL. Long enough for a slow full download. */
const SIGNED_URL_TTL_SEC = 3600

// GET /api/tracks/[id]/stream
//
// The stored FLAC for a track (see lib/trackDelivery.ts):
//   ?signed=1 → JSON { url, expiresAt }: a presigned R2 GET the browser reads
//               directly (lib/trackAudioFetch.ts — the normal path).
//   otherwise → the bytes, streamed through this function with Range
//               passthrough (fallback path, and what older clients call).
//               Never buffered: the previous version loaded the whole FLAC
//               into memory per request, Range requests included.
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
      .select('storage_path, file_type')
      .eq('id', trackId)
      .single()
    if (error || !track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const contentType = track.file_type === 'midi' ? 'audio/midi' : 'audio/flac'

    if (req.nextUrl.searchParams.get('signed') === '1') {
      const url = await getPresignedDownloadUrl(track.storage_path, null, SIGNED_URL_TTL_SEC)
      return NextResponse.json(
        { url, expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000 },
        { headers: { 'Cache-Control': STREAM_CACHE_CONTROL, Vary: 'Cookie' } },
      )
    }

    return await r2ObjectResponse(req, track.storage_path, { contentType })
  } catch (err) {
    console.error('[stream]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

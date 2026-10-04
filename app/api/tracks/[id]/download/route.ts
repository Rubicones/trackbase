import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getPresignedDownloadUrl } from '@/lib/r2'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'
import { ensureWavInR2, r2ObjectResponse, wavCacheKey } from '@/lib/trackDelivery'

// A first download of a long hi-res track renders the WAV (streamed
// R2 → ffmpeg → R2); later downloads are a cache hit and return instantly.
export const maxDuration = 300

/** Signed download links only need to outlive the redirect + the transfer start. */
const DOWNLOAD_URL_TTL_SEC = 3600

// GET /api/tracks/[id]/download
//
// Audio: the track as WAV at its native rate/bit depth, shifted by its
// start_bar offset so it lines up with the project timeline. The WAV is
// rendered once into the R2 cache (lib/trackDelivery.ts → wavCacheKey) and
// served from there. MIDI: the raw .mid.
//
// Default: 302 to a presigned R2 URL (Content-Disposition: attachment) — the
// browser downloads straight from Cloudflare, resumable, no function memory.
// ?proxy=1: the same bytes streamed through this function, for fetch() callers
// whose direct request failed (e.g. R2 CORS). See lib/trackDelivery.ts.
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
      .select('storage_path, original_filename, name, file_type, version_id, start_bar, midi_start_bar')
      .eq('id', trackId)
      .single()
    if (error || !track) return NextResponse.json({ error: 'Track not found' }, { status: 404 })

    const baseName = (track.original_filename ?? track.name).replace(/\.[^/.]+$/, '')
    const proxy = req.nextUrl.searchParams.get('proxy') === '1'

    let key: string
    let filename: string
    let contentType: string

    if (track.file_type === 'midi') {
      key = track.storage_path
      filename = `${baseName}.mid`
      contentType = 'audio/midi'
    } else {
      const { data: version } = await supabase
        .from('versions')
        .select('project_id')
        .eq('id', track.version_id)
        .maybeSingle()

      let bpm = 120
      let timeSignature = '4/4'
      if (version) {
        const { data: project } = await supabase
          .from('projects')
          .select('bpm, time_signature')
          .eq('id', version.project_id)
          .maybeSingle()
        bpm = project?.bpm ?? 120
        timeSignature = project?.time_signature ?? '4/4'
      }

      const delayMs = startBarToMs(trackStartBar(track), bpm, timeSignature)
      key = wavCacheKey(track.storage_path, delayMs)
      await ensureWavInR2(track.storage_path, key, delayMs)
      filename = `${baseName}.wav`
      contentType = 'audio/wav'
    }

    if (proxy) {
      return await r2ObjectResponse(req, key, { contentType, filename })
    }

    const url = await getPresignedDownloadUrl(key, filename, DOWNLOAD_URL_TTL_SEC)
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    console.error('[download]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

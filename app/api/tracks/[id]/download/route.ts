import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { flacToWav } from '@/lib/ffmpeg'
import { requireBandMemberForTrack } from '@/lib/supabase/server'
import { trackStartBar, startBarToMs } from '@/lib/trackMerge'

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
      .select('storage_path, original_filename, name, file_type, version_id, start_bar, midi_start_bar')
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

    // Shift the WAV by the track's start_bar offset (silence-pad or trim) so a
    // standalone download still lines up with the project timeline it plays on.
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

    const flacBuffer = await downloadFromR2(track.storage_path)
    const delayMs = startBarToMs(trackStartBar(track), bpm, timeSignature)
    const wavBuffer = await flacToWav(flacBuffer, delayMs)

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

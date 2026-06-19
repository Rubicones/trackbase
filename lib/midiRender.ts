/**
 * Offline render of MIDI track data to an AudioBuffer (same soundfont as live preview).
 * Used for mixer transport playback — avoids per-note scheduling artifacts.
 */
import { sixteenthDuration } from '@/lib/midi'
import { getMidiInstrument } from '@/lib/midiSoundfont'
import type { Track } from '@/lib/types'

const RENDER_TAIL_SEC = 0.2

/** Cache-bust key when MIDI content, instrument, or project tempo grid changes. */
export function midiRenderSourceKey(
  track: Track,
  projectBpm: number,
  projectTimeSig: string,
): string {
  const instrument = track.midi_data?.instrument ?? -1
  return `${track.file_hash ?? ''}|${instrument}|${projectBpm}|${projectTimeSig}`
}

export function midiContentDurationSec(track: Track, projectBpm: number): number {
  const data = track.midi_data
  if (!data?.notes?.length) return 0
  const sixthSec = sixteenthDuration(projectBpm)
  const lastEnd = Math.max(...data.notes.map(n => n.startSixteenth + n.durationSixteenths))
  return lastEnd * sixthSec
}

/**
 * Render MIDI notes into a stereo AudioBuffer at `playbackSampleRate`.
 * Notes are placed at project BPM; `start_bar` is applied at playback time (like audio tracks).
 */
export async function renderMidiTrackToBuffer(
  playbackSampleRate: number,
  track: Track,
  projectBpm: number,
): Promise<AudioBuffer | null> {
  const data = track.midi_data
  if (!data?.notes?.length) return null

  const contentSec = midiContentDurationSec(track, projectBpm)
  if (contentSec <= 0) return null

  const durationSec = contentSec + RENDER_TAIL_SEC
  const length = Math.max(1, Math.ceil(durationSec * playbackSampleRate))
  const offline = new OfflineAudioContext(2, length, playbackSampleRate)

  const instrument = await getMidiInstrument(offline, data.instrument)
  const sixthSec = sixteenthDuration(projectBpm)

  for (const note of data.notes) {
    const startSec = note.startSixteenth * sixthSec
    const durSec = note.durationSixteenths * sixthSec
    instrument.play(note.pitch.toString(), startSec, {
      duration: durSec,
      gain: note.velocity / 127,
    })
  }

  return offline.startRendering()
}

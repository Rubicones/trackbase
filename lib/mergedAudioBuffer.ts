import { getContext, start, ToneAudioBuffer } from 'tone'
import type { Track } from '@/lib/types'
import { fetchTrackAudioBuffer } from '@/lib/waveformCache'

function barDurationSec(bpm: number, timeSignature: string): number {
  const beatsPerBar = parseInt(timeSignature.split('/')[0], 10) || 4
  return (60 / bpm) * beatsPerBar
}

export { barDurationSec }

async function decodeTrackMono(
  ctx: AudioContext,
  track: Track,
): Promise<Float32Array | null> {
  if (track.file_type === 'midi') return null

  const ab = await fetchTrackAudioBuffer(track.id)
  if (!ab) return null

  const decoded = await ctx.decodeAudioData(ab)
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice()

  const mix = new Float32Array(decoded.length)
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c)
    for (let i = 0; i < mix.length; i++) mix[i] += ch[i] / decoded.numberOfChannels
  }
  return mix
}

/**
 * Build a mono merged Tone.js buffer from selected audio tracks (respecting start_bar offsets).
 */
export async function getMergedToneBuffer(
  tracks: Track[],
  projectBpm: number,
  timeSignature: string,
  totalDurationSec: number,
  selectedTrackIds: string[],
): Promise<ToneAudioBuffer | null> {
  const idSet = new Set(selectedTrackIds)
  const audioTracks = tracks.filter(t => t.file_type !== 'midi' && idSet.has(t.id))
  if (audioTracks.length === 0) return null

  await start()
  const ctx = getContext().rawContext as AudioContext
  const sampleRate = ctx.sampleRate
  const barDurSec = barDurationSec(projectBpm, timeSignature)
  const length = Math.max(1, Math.ceil(totalDurationSec * sampleRate))
  const mix = new Float32Array(length)

  for (const track of audioTracks) {
    const samples = await decodeTrackMono(ctx, track)
    if (!samples) continue
    const offsetSamples = Math.round((track.start_bar ?? 0) * barDurSec * sampleRate)
    for (let i = 0; i < samples.length && offsetSamples + i < length; i++) {
      mix[offsetSamples + i] += samples[i]
    }
  }

  let peak = 0
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]))
  if (peak > 1e-6 && peak > 1) {
    for (let i = 0; i < mix.length; i++) mix[i] /= peak
  }

  const audioBuffer = ctx.createBuffer(1, mix.length, sampleRate)
  audioBuffer.copyToChannel(mix, 0)
  return new ToneAudioBuffer(audioBuffer)
}

/**
 * Slice a section's time range from a Tone.js buffer (channel 0).
 */
export function sliceSectionFromToneBuffer(
  buffer: ToneAudioBuffer,
  startTimeSec: number,
  endTimeSec: number,
): Float32Array {
  return buffer.slice(startTimeSec, endTimeSec).getChannelData(0)
}

export function sectionTimeRangeSec(
  startBar: number,
  endBar: number,
  projectBpm: number,
  timeSignature: string,
): { startTimeSec: number; endTimeSec: number } {
  const barDurSec = barDurationSec(projectBpm, timeSignature)
  return {
    startTimeSec: startBar * barDurSec,
    endTimeSec: endBar * barDurSec,
  }
}

import { audioArrayBufferCache, waveformBarsCache, waveformDurationCache, fetchTrackAudioBuffer } from '@/lib/waveformCache'
import type { Track } from '@/lib/types'

/** Decode peak bars for a single track (uses module caches). */
export async function decodeWaveformBars(
  trackId: string,
  barCount = 96,
): Promise<number[] | null> {
  const existing = waveformBarsCache.get(trackId)
  if (existing) return existing

  try {
    const cachedAB = audioArrayBufferCache.get(trackId)
    let ab: ArrayBuffer | null
    if (cachedAB) {
      ab = cachedAB.slice(0)
    } else {
      ab = await fetchTrackAudioBuffer(trackId)
      if (!ab) return null
    }

    const actx = new AudioContext()
    const decoded = await actx.decodeAudioData(ab)
    actx.close()

    const raw = decoded.getChannelData(0)
    const block = Math.max(1, Math.floor(raw.length / barCount))
    const amps: number[] = []
    for (let i = 0; i < barCount; i++) {
      let s = 0
      for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j])
      amps.push(s / block)
    }
    const max = Math.max(...amps, 0.001)
    const bars = amps.map(a => a / max)
    const decodedMs = Math.round(decoded.duration * 1000)
    waveformBarsCache.set(trackId, bars)
    if (decodedMs > 0) waveformDurationCache.set(trackId, decodedMs)
    return bars
  } catch {
    return null
  }
}

export function buildCompositeFromBars(trackBarSets: number[][], barCount: number): number[] {
  if (!trackBarSets.length) return new Array(barCount).fill(0.12)
  const sum = new Array(barCount).fill(0)
  for (const bars of trackBarSets) {
    for (let i = 0; i < barCount; i++) sum[i] += bars[i] ?? 0
  }
  const max = Math.max(...sum, 0.001)
  return sum.map(v => v / max)
}

/** Average audio track waveforms into one composite peak array. */
export async function buildCompositeWaveform(
  tracks: Track[],
  barCount = 96,
): Promise<number[]> {
  const audioTracks = tracks.filter(t => t.file_type !== 'midi')
  const barSets = (
    await Promise.all(audioTracks.map(t => decodeWaveformBars(t.id, barCount)))
  ).filter((b): b is number[] => !!b)
  return buildCompositeFromBars(barSets, barCount)
}

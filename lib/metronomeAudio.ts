/** Virtual track id for the hidden metronome buffer in the mixer player. */
export const METRONOME_TRACK_ID = '__metronome__'

export function beatsPerBarFromTimeSig(timeSignature: string): number {
  return parseInt(timeSignature.split('/')[0], 10) || 4
}

export function beatDurationSec(bpm: number): number {
  return 60 / bpm
}

export function barDurationSec(bpm: number, timeSignature: string): number {
  return beatDurationSec(bpm) * beatsPerBarFromTimeSig(timeSignature)
}

/** Mix a short square-wave click into a mono channel at `timeSec`. */
function mixClick(
  channel: Float32Array,
  sampleRate: number,
  timeSec: number,
  isDownbeat: boolean,
): void {
  const freq = isDownbeat ? 1000 : 700
  const startSample = Math.round(timeSec * sampleRate)
  const clickSamples = Math.ceil(0.06 * sampleRate)
  const amp = 0.22
  for (let i = 0; i < clickSamples; i++) {
    const idx = startSample + i
    if (idx < 0 || idx >= channel.length) continue
    const t = i / sampleRate
    const env = amp * Math.exp(-t / 0.02)
    const sample = Math.sign(Math.sin(2 * Math.PI * freq * t)) * env
    channel[idx] += sample
  }
}

/**
 * Render a metronome click at an absolute AudioContext time.
 * Returns the OscillatorNode for optional cancellation.
 */
export function scheduleClick(
  audioCtx: AudioContext,
  destination: AudioNode,
  time: number,
  isDownbeat: boolean,
): OscillatorNode {
  const osc = audioCtx.createOscillator()
  const env = audioCtx.createGain()
  osc.type = 'square'
  osc.frequency.value = isDownbeat ? 1000 : 700
  env.gain.setValueAtTime(0.22, time)
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
  osc.connect(env)
  env.connect(destination)
  osc.start(time)
  osc.stop(time + 0.06)
  return osc
}

/**
 * Build a mono metronome buffer aligned to bar 1 / beat 0 at t = 0.
 * Clicks continue through `durationSec`.
 */
export function generateMetronomeBuffer(
  ctx: AudioContext,
  bpm: number,
  timeSignature: string,
  durationSec: number,
): AudioBuffer {
  const beatsPerBar = beatsPerBarFromTimeSig(timeSignature)
  const beatDur = beatDurationSec(bpm)
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.ceil(durationSec * sampleRate))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  const totalBeats = Math.ceil(durationSec / beatDur) + 1
  for (let beat = 0; beat < totalBeats; beat++) {
    const t = beat * beatDur
    if (t >= durationSec) break
    mixClick(data, sampleRate, t, beat % beatsPerBar === 0)
  }

  return buffer
}

/**
 * Simple count-in: `beatsPerBar` clicks at project BPM, starting immediately.
 * Independent of playhead position and the metronome track.
 */
export function playCountdown(
  audioCtx: AudioContext,
  destination: AudioNode,
  bpm: number,
  timeSig: string,
): Promise<void> {
  const beatsPerBar = beatsPerBarFromTimeSig(timeSig)
  const beatDur = beatDurationSec(bpm)
  const barDur = beatDur * beatsPerBar
  const countdownStart = audioCtx.currentTime + 0.05

  for (let i = 0; i < beatsPerBar; i++) {
    scheduleClick(audioCtx, destination, countdownStart + i * beatDur, i === 0)
  }

  return new Promise(resolve => setTimeout(resolve, Math.round(barDur * 1000) + 80))
}

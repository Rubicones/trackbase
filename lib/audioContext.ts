// Shared AudioContext singleton — playback, metronome, and recording monitor.
// All audible paths mix through one GainNode → destination (never wire mic
// monitor and track playback to destination on separate edges — Chrome hangs).
// Re-created only if the previous context was closed.

const TARGET_SAMPLE_RATE = 48000

let _ctx: AudioContext | null = null
let _masterOut: GainNode | null = null

export function getSharedAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: TARGET_SAMPLE_RATE,
    })
    _masterOut = null
  }
  return _ctx
}

/** Single mix bus — tracks, metronome monitor, and recording monitor all connect here. */
export function getMasterOutput(): GainNode {
  const ctx = getSharedAudioContext()
  if (!_masterOut || _masterOut.context !== ctx || _masterOut.context.state === 'closed') {
    _masterOut = ctx.createGain()
    _masterOut.gain.value = 1
    _masterOut.connect(ctx.destination)
  }
  return _masterOut
}

export const PLAYBACK_SAMPLE_RATE = TARGET_SAMPLE_RATE

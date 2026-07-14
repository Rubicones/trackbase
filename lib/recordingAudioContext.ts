// Isolated AudioContext for mic capture + monitoring.
// Kept separate from the shared playback context — wiring getUserMedia into the
// same graph as multi-track playback has caused Chrome tab freezes on macOS.
//
// IMPORTANT: no explicit sampleRate. The mic stream runs at the hardware rate
// (typically 44.1/48 kHz); forcing this context to a different rate (we used
// to pin 22050) makes createMediaStreamSource resample every block, which is
// exactly the "weak / glitchy monitoring" failure mode. 'interactive' already
// requests a low-latency buffer without demanding the minimum the hardware
// may not sustain.

let _ctx: AudioContext | null = null

export function getRecordingAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext({ latencyHint: 'interactive' })
  }
  return _ctx
}

export async function resumeRecordingAudioContext(): Promise<AudioContext> {
  const ctx = getRecordingAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  return ctx
}

export function closeRecordingAudioContext(): void {
  if (_ctx && _ctx.state !== 'closed') void _ctx.close()
  _ctx = null
}

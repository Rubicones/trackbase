// Isolated AudioContext for mic capture + monitoring.
// Kept separate from the shared playback context — wiring getUserMedia into the
// same graph as multi-track playback has caused Chrome tab freezes on macOS.

let _ctx: AudioContext | null = null

export function getRecordingAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext({
      latencyHint: 0,     // request minimum buffer size
      sampleRate: 22050,  // half rate → smaller buffers, lower latency
    })
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

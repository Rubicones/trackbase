// Shared microphone acquisition for recording.
//
// Every code path that opens the mic (initial auto-arm, mobile transport
// prefetch, device switch, re-record) MUST use these constraints. Using plain
// `{ audio: true }` enables echo cancellation, noise suppression and auto gain
// control, which mangles music signals: the browser ducks/cancels anything
// that correlates with playback output, producing the "weak and glitchy first
// take" bug. Music capture needs the raw signal.
import { resumeRecordingAudioContext } from '@/lib/recordingAudioContext'

export function micAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    // Mono is enough for demo takes and halves upload size. No sampleRate
    // constraint: forcing a rate the hardware doesn't run natively (e.g.
    // 22050 on a 48k interface) makes the UA resample and can glitch.
    channelCount: { ideal: 1 },
  }
}

export async function acquireMicStream(deviceId?: string): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: micAudioConstraints(deviceId),
    video: false,
  })
  // Unlock the monitoring AudioContext under the same user gesture as the
  // permission prompt — resume() from a later useEffect is often ignored.
  try { await resumeRecordingAudioContext() } catch { /* non-fatal */ }
  return stream
}

/** True if the stream exists and still has at least one live audio track. */
export function isMicStreamLive(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getAudioTracks().some(t => t.readyState === 'live')
}

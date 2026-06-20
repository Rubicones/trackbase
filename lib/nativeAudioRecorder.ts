// Native audio capture for the Capacitor shell.
//
// On Android the WebView getUserMedia / MediaRecorder stack is unreliable
// (OS mic permission isn't forwarded into the WebView without custom
// WebChromeClient handling). Instead we capture raw PCM via a local Capacitor
// plugin ("NativeAudioRecorder", implemented in the android/ project using
// AudioRecord) and hand a finished WAV file back to the web upload pipeline.
//
// The JS side never touches getUserMedia when Capacitor.isNativePlatform().

import { registerPlugin } from '@capacitor/core'

export interface NativeAudioRecorderPlugin {
  /** Request microphone permission through the native system dialog. */
  requestPermission(): Promise<{ granted: boolean }>

  /** Check current permission status without prompting. */
  checkPermission(): Promise<{ granted: boolean }>

  /**
   * Start recording. Returns immediately; capture runs on a background thread.
   * `sampleRate` is a hint — the actual rate used is reported by stopRecording.
   */
  startRecording(options: { sampleRate: number; channels: number }): Promise<void>

  /** Stop recording and write a WAV file into the app cache directory. */
  stopRecording(): Promise<{
    filePath: string
    durationMs: number
    sampleRate: number
  }>

  /** Stop and discard the current recording without writing a file. */
  cancelRecording(): Promise<void>

  /** Read a recorded WAV file as base64 (for the upload pipeline). */
  readAsBase64(options: { filePath: string }): Promise<{ data: string }>

  /** Delete a temp WAV file once it has been consumed. */
  deleteFile(options: { filePath: string }): Promise<void>
}

export const NativeAudioRecorder =
  registerPlugin<NativeAudioRecorderPlugin>('NativeAudioRecorder')

/** Decode a base64 WAV payload into an audio/wav Blob. */
export function wavBase64ToBlob(data: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: 'audio/wav' })
}

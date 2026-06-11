/**
 * Module-scope caches shared between the project player and the structure editor.
 * Living at module scope means they survive component unmount/remount for the
 * lifetime of the browser tab.
 */

/** Decoded waveform bar amplitudes per track ID (72 floats, normalised 0–1). */
export const waveformBarsCache = new Map<string, number[]>()

/** Raw audio ArrayBuffer per track ID.
 *  decodeAudioData() detaches the buffer, so callers must .slice(0) before decoding. */
export const audioArrayBufferCache = new Map<string, ArrayBuffer>()

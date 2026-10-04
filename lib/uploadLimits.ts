/**
 * Track upload limits — the single source for both the browser pre-check and
 * the server gates (presign → process). Never inline these numbers.
 *
 * Two limits, protecting two different things:
 *
 * - MAX_TRACK_UPLOAD_BYTES bounds the raw upload the server has to move and
 *   transcode. The presign route checks the size the browser *declares*; the
 *   process route checks the size R2 actually holds (HeadObject), because a
 *   presigned PUT does not pin Content-Length — the declared number is not
 *   evidence of anything.
 *
 * - MAX_TRACK_DURATION_MS bounds what the mixer has to hold in memory. Every
 *   track is decoded whole into the shared 48 kHz AudioContext, ~23 MB of RAM
 *   per stereo minute regardless of the file's format, so length — not bytes —
 *   is what crashes a phone tab. A 200 MB MP3 can run for hours.
 */

export const MAX_TRACK_UPLOAD_BYTES = 1024 * 1024 * 1024 // 1 GB

export const MAX_TRACK_DURATION_MS = 20 * 60 * 1000 // 20 minutes

/** MIDI is parsed in memory; real MIDI files are kilobytes. */
export const MAX_MIDI_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export function fmtUploadLimitBytes(bytes = MAX_TRACK_UPLOAD_BYTES): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${+(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`
}

export function tooLargeMessage(limit = MAX_TRACK_UPLOAD_BYTES): string {
  return `File too large. Maximum size is ${fmtUploadLimitBytes(limit)}.`
}

export function tooLongMessage(): string {
  return `Track too long. Maximum length is ${Math.round(MAX_TRACK_DURATION_MS / 60000)} minutes.`
}

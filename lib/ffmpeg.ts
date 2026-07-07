import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'

function resolveFfmpegPath(): string {
  const candidates: string[] = []

  if (typeof ffmpegStatic === 'string') candidates.push(ffmpegStatic)

  candidates.push(
    path.join(/* turbopackIgnore: true */ process.cwd(), 'node_modules/ffmpeg-static/ffmpeg'),
  )

  // Traced binary may sit beside the compiled handler on Vercel.
  if (typeof __dirname !== 'undefined') {
    candidates.push(
      path.join(__dirname, 'ffmpeg'),
      path.join(__dirname, 'node_modules/ffmpeg-static/ffmpeg'),
    )
  }

  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }

  // System ffmpeg (local dev fallback)
  try {
    const p = execSync('which ffmpeg', { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch { /* not in PATH */ }

  throw new Error(
    'ffmpeg binary not found. ' +
    'Either run `npm install` to restore ffmpeg-static, ' +
    'or install ffmpeg on your system: `brew install ffmpeg`'
  )
}

let ffmpegPathConfigured = false

/** Resolve and configure ffmpeg only when a conversion runs (not at import time). */
export function ensureFfmpegConfigured(): void {
  if (ffmpegPathConfigured) return
  ffmpeg.setFfmpegPath(resolveFfmpegPath())
  ffmpegPathConfigured = true
}

export async function audioToFlac(
  buffer: Buffer,
  inputFormat: 'wav' | 'mp3'
): Promise<{ flac: Buffer; durationMs: number }> {
  ensureFfmpegConfigured()
  const id = randomUUID()
  const inPath = path.join(tmpdir(), `${id}.${inputFormat}`)
  const outPath = path.join(tmpdir(), `${id}.flac`)

  try {
    await writeFile(inPath, buffer)

    // Probe input duration (fast, runs on already-written file)
    const durationMs = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(inPath, (_err, meta) => {
        resolve(_err ? 0 : Math.round((meta?.format?.duration ?? 0) * 1000))
      })
    })

    // Convert to FLAC
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .audioCodec('flac')
        .audioFrequency(48000)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    return { flac: await readFile(outPath), durationMs }
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

/**
 * Like audioToFlac but takes an existing file path as input.
 * Use this when the audio file has already been written to disk
 * (e.g. downloaded from R2) to avoid the extra write step.
 * The caller is responsible for deleting inPath afterward.
 */
export async function audioToFlacFromFile(
  inPath: string,
  inputFormat: 'wav' | 'mp3',
): Promise<{ flac: Buffer; durationMs: number }> {
  ensureFfmpegConfigured()
  const id = randomUUID()
  const outPath = path.join(tmpdir(), `${id}.flac`)

  try {
    const durationMs = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(inPath, (_err, meta) => {
        resolve(_err ? 0 : Math.round((meta?.format?.duration ?? 0) * 1000))
      })
    })

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .audioCodec('flac')
        .audioFrequency(48000)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    return { flac: await readFile(outPath), durationMs }
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

/**
 * Convert a FLAC buffer to WAV. `delayMs` applies the track's start_bar offset:
 * positive pads the front with silence, negative trims that much off the start
 * (pre-roll before bar 1) — mirrors the adelay/atrim logic in lib/previewMix.ts
 * so exported/downloaded audio lines up with what plays in the app.
 */
export async function flacToWav(flacBuffer: Buffer, delayMs = 0): Promise<Buffer> {
  ensureFfmpegConfigured()
  const id = randomUUID()
  const inPath = path.join(tmpdir(), `${id}.flac`)
  const outPath = path.join(tmpdir(), `${id}.wav`)

  try {
    await writeFile(inPath, flacBuffer)
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath).audioCodec('pcm_s24le').audioFrequency(48000)

      const roundedDelay = Math.round(delayMs)
      if (roundedDelay > 0) {
        cmd.audioFilters(`adelay=${roundedDelay}:all=1`)
      } else if (roundedDelay < 0) {
        const trimSec = (-roundedDelay / 1000).toFixed(6)
        cmd.audioFilters([`atrim=start=${trimSec}`, 'asetpts=PTS-STARTPTS'])
      }

      cmd
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })
    return await readFile(outPath)
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

// ─── Non-destructive track edit rendering ─────────────────────────────────────

export interface RenderEditClip {
  /** Bar offset into the source file's own bar grid. */
  srcBar: number
  lenBars: number
}

export interface RenderEditSegment {
  /** Timeline bar where the segment starts (bar 0 = output file start). */
  startBar: number
  clips: RenderEditClip[]
}

/**
 * Render a track edit session (bar-aligned segments referencing ranges of the
 * source file) into a single FLAC covering bar 0 → end of content. Gaps
 * between/before segments become silence; a clip that runs past the end of
 * the source audio is padded with silence to fill its bar slot — identical to
 * the in-browser Web Audio preview.
 */
export async function renderEditedFlac(
  sourcePath: string,
  segments: RenderEditSegment[],
  barDurSec: number,
): Promise<{ flac: Buffer; durationMs: number }> {
  ensureFfmpegConfigured()
  const id = randomUUID()
  const outPath = path.join(tmpdir(), `${id}.flac`)

  const sourceDurSec = await new Promise<number>((resolve) => {
    ffmpeg.ffprobe(sourcePath, (_err, meta) => {
      resolve(_err ? 0 : (meta?.format?.duration ?? 0))
    })
  })

  const FMT = 'aformat=sample_fmts=s32:sample_rates=48000:channel_layouts=stereo'

  // Flatten timeline into ordered pieces (silence gaps + source slices).
  type Piece =
    | { kind: 'silence'; durSec: number }
    | { kind: 'clip'; startSec: number; endSec: number; slotSec: number }
  const pieces: Piece[] = []

  const sorted = [...segments].sort((a, b) => a.startBar - b.startBar)
  let cursorBar = 0
  for (const seg of sorted) {
    if (seg.startBar > cursorBar) {
      pieces.push({ kind: 'silence', durSec: (seg.startBar - cursorBar) * barDurSec })
      cursorBar = seg.startBar
    }
    for (const clip of seg.clips) {
      const slotSec = clip.lenBars * barDurSec
      const srcStartSec = clip.srcBar * barDurSec
      const audibleSec = Math.min(slotSec, Math.max(0, sourceDurSec - srcStartSec))
      if (audibleSec <= 0.001) {
        pieces.push({ kind: 'silence', durSec: slotSec })
      } else {
        pieces.push({ kind: 'clip', startSec: srcStartSec, endSec: srcStartSec + audibleSec, slotSec })
      }
      cursorBar += clip.lenBars
    }
  }
  if (pieces.length === 0) throw new Error('Nothing to render')

  // A filter input pad can only be consumed once — asplit the source when
  // several pieces slice it.
  const clipCount = pieces.filter(p => p.kind === 'clip').length
  const filters: string[] = []
  if (clipCount > 1) {
    filters.push(
      `[0:a]asplit=${clipCount}${Array.from({ length: clipCount }, (_, i) => `[in${i}]`).join('')}`,
    )
  }

  const labels: string[] = []
  let clipIdx = 0
  pieces.forEach((piece, i) => {
    const label = `p${i}`
    if (piece.kind === 'silence') {
      filters.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${piece.durSec.toFixed(6)},${FMT}[${label}]`,
      )
    } else {
      const inLabel = clipCount > 1 ? `[in${clipIdx}]` : '[0:a]'
      clipIdx += 1
      filters.push(
        `${inLabel}atrim=start=${piece.startSec.toFixed(6)}:end=${piece.endSec.toFixed(6)},` +
        `asetpts=PTS-STARTPTS,${FMT},apad=whole_dur=${piece.slotSec.toFixed(6)}[${label}]`,
      )
    }
    labels.push(`[${label}]`)
  })

  filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`)

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(sourcePath)
        .complexFilter(filters)
        .outputOptions(['-map', '[out]'])
        .audioCodec('flac')
        .audioFrequency(48000)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    const durationMs = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(outPath, (_err, meta) => {
        resolve(_err ? 0 : Math.round((meta?.format?.duration ?? 0) * 1000))
      })
    })

    return { flac: await readFile(outPath), durationMs }
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

/** Sample rate the chord/key detection pipeline expects (matches the browser worker's Web Audio decode). */
export const CHORD_DETECTION_SAMPLE_RATE = 44100

/**
 * Decode an arbitrary audio buffer (mp3/wav/flac/ogg/m4a) into mono 32-bit
 * float PCM at CHORD_DETECTION_SAMPLE_RATE — the format the in-browser
 * Essentia worker normally gets from Web Audio's decodeAudioData(). Used by
 * the server-side chord detection route so the same analysis pipeline can
 * run on an uploaded file without a browser.
 *
 * Input is never written anywhere but a temp file that's deleted in the
 * `finally` block — nothing persists after this function returns.
 */
export async function decodeAudioToPcmFloat32(
  buffer: Buffer,
  inputExt: 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a',
): Promise<{ pcm: Float32Array; durationSeconds: number }> {
  ensureFfmpegConfigured()
  const id = randomUUID()
  const inPath = path.join(tmpdir(), `${id}.${inputExt}`)
  const outPath = path.join(tmpdir(), `${id}.pcm`)

  try {
    await writeFile(inPath, buffer)

    const probedDurationSec = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(inPath, (_err, meta) => {
        resolve(_err ? 0 : (meta?.format?.duration ?? 0))
      })
    })

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .outputOptions(['-f', 'f32le', '-ac', '1', '-ar', String(CHORD_DETECTION_SAMPLE_RATE)])
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    const raw = await readFile(outPath)
    const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4))
    const durationSeconds = probedDurationSec > 0 ? probedDurationSec : pcm.length / CHORD_DETECTION_SAMPLE_RATE

    return { pcm, durationSeconds }
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

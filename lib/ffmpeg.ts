import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink, open } from 'fs/promises'
import path from 'path'
import { Transform, type Readable } from 'stream'

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

/**
 * Resolve the ffprobe binary. ffmpeg-static ships ONLY ffmpeg, so ffprobe is
 * absent in production (Vercel) — without this, ffmpeg.ffprobe() spawns a
 * non-existent `ffprobe` on PATH, fails, and callers silently get duration 0.
 * ffprobe-static bundles a per-platform binary; fall back to system ffprobe for
 * local dev.
 */
function resolveFfprobePath(): string | null {
  const candidates: string[] = []

  const staticPath = (ffprobeStatic as { path?: string } | undefined)?.path
  if (staticPath) candidates.push(staticPath)

  // Traced binary layout on Vercel (mirrors the ffmpeg-static handling above).
  candidates.push(
    path.join(process.cwd(), 'node_modules/ffprobe-static/bin', process.platform, process.arch, 'ffprobe'),
  )
  if (typeof __dirname !== 'undefined') {
    candidates.push(
      path.join(__dirname, 'node_modules/ffprobe-static/bin', process.platform, process.arch, 'ffprobe'),
    )
  }

  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }

  try {
    const p = execSync('which ffprobe', { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch { /* not in PATH */ }

  return null
}

let ffmpegPathConfigured = false
let resolvedFfmpegPath: string | null = null

/** Resolve and configure ffmpeg only when a conversion runs (not at import time). */
export function ensureFfmpegConfigured(): void {
  if (ffmpegPathConfigured) return
  resolvedFfmpegPath = resolveFfmpegPath()
  ffmpeg.setFfmpegPath(resolvedFfmpegPath)
  const ffprobePath = resolveFfprobePath()
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath)
  ffmpegPathConfigured = true
}

// ─── Sample rate / bit depth policy ───────────────────────────────────────────
//
// Stored FLACs keep the uploaded file's NATIVE sample rate and bit depth — a
// 96 kHz/24-bit WAV is stored, downloaded and exported as 96 kHz/24-bit. The
// only ceiling is MAX_STORED_SAMPLE_RATE: anything above it (352.8/384 kHz DXD)
// is resampled down to it, because the size cost buys nothing audible.
//
// Mixed-rate projects are expected. Playback is unaffected (the browser's
// shared AudioContext is pinned to 48 kHz and decodeAudioData resamples every
// buffer to it); server-side mixes that combine stems pin their output to
// MIX_OUTPUT_SAMPLE_RATE so the result doesn't depend on which stems are in it.
//
// Not lossless for 32-bit float WAVs: FLAC stores integers only, so ffmpeg
// encodes float input as 24-bit and anything above 0 dBFS clips.

/** Upper bound for stored audio; higher-rate uploads are resampled to this. */
export const MAX_STORED_SAMPLE_RATE = 192000

/** Output rate for server-rendered mixes (preview mix, /mix) that combine stems of possibly different rates. */
export const MIX_OUTPUT_SAMPLE_RATE = 48000

/** Rate assumed when a FLAC's STREAMINFO header can't be read. */
const FALLBACK_SAMPLE_RATE = 48000

export interface FlacStreamInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: number
}

/**
 * Parse the mandatory STREAMINFO block at the head of a FLAC stream. Every
 * FLAC we write starts with it (ffmpeg emits `fLaC` + STREAMINFO first), so the
 * first 42 bytes are enough — no ffprobe needed. Returns null for anything that
 * isn't a well-formed FLAC header.
 */
export function parseFlacStreamInfo(head: Uint8Array): FlacStreamInfo | null {
  if (head.length < 42) return null
  // "fLaC"
  if (head[0] !== 0x66 || head[1] !== 0x4c || head[2] !== 0x61 || head[3] !== 0x43) return null
  // First metadata block must be STREAMINFO (type 0) with length 34
  if ((head[4] & 0x7f) !== 0) return null
  const len = (head[5] << 16) | (head[6] << 8) | head[7]
  if (len !== 34) return null
  // STREAMINFO body starts at 8; sample rate begins at body offset 10 → byte 18
  const sampleRate = (head[18] << 12) | (head[19] << 4) | (head[20] >> 4)
  const channels = ((head[20] >> 1) & 0x07) + 1
  const bitsPerSample = (((head[20] & 0x01) << 4) | (head[21] >> 4)) + 1
  const totalSamples = (head[21] & 0x0f) * 2 ** 32 +
    ((head[22] << 24) >>> 0) + (head[23] << 16) + (head[24] << 8) + head[25]
  if (sampleRate <= 0) return null
  return { sampleRate, channels, bitsPerSample, totalSamples }
}

/** Read STREAMINFO from a FLAC file on disk (only the first 42 bytes are read). */
export async function readFlacStreamInfo(filePath: string): Promise<FlacStreamInfo | null> {
  const fh = await open(filePath, 'r').catch(() => null)
  if (!fh) return null
  try {
    const head = Buffer.alloc(42)
    const { bytesRead } = await fh.read(head, 0, 42, 0)
    return parseFlacStreamInfo(head.subarray(0, bytesRead))
  } finally {
    await fh.close().catch(() => {})
  }
}

export async function audioToFlac(
  buffer: Buffer,
  inputFormat: 'wav' | 'mp3',
  opts: { maxDurationMs?: number } = {},
): Promise<{ flac: Buffer; durationMs: number }> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.${inputFormat}`)
  try {
    await writeFile(inPath, buffer)
    return await audioToFlacFromFile(inPath, opts)
  } finally {
    await unlink(inPath).catch(() => {})
  }
}

/**
 * Like audioToFlac but takes an existing file path as input.
 * Use this when the audio file has already been written to disk
 * (e.g. downloaded from R2) to avoid the extra write step.
 * The caller is responsible for deleting inPath afterward.
 *
 * Keeps the input's native sample rate and bit depth (see the policy above).
 */
/** Thrown by audioToFlacFromFile when the input is longer than `maxDurationMs`. */
export class AudioTooLongError extends Error {
  constructor(public durationMs: number) {
    super(`Audio is ${Math.round(durationMs / 1000)} s long`)
    this.name = 'AudioTooLongError'
  }
}

export async function audioToFlacFromFile(
  inPath: string,
  opts: { maxDurationMs?: number } = {},
): Promise<{ flac: Buffer; durationMs: number }> {
  ensureFfmpegConfigured()
  const outPath = path.join(tmpdir(), `${randomUUID()}.flac`)

  try {
    const probe = await new Promise<{ durationMs: number; sampleRate: number }>((resolve) => {
      ffmpeg.ffprobe(inPath, (_err, meta) => {
        if (_err) return resolve({ durationMs: 0, sampleRate: 0 })
        const audio = meta?.streams?.find(st => st.codec_type === 'audio')
        resolve({
          durationMs: Math.round((meta?.format?.duration ?? 0) * 1000),
          sampleRate: Number(audio?.sample_rate ?? 0) || 0,
        })
      })
    })

    // Refuse before spending the conversion when the probe already knows.
    if (opts.maxDurationMs && probe.durationMs > opts.maxDurationMs) {
      throw new AudioTooLongError(probe.durationMs)
    }

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(inPath).audioCodec('flac')
      // Native rate unless it exceeds the ceiling. If ffprobe is unavailable
      // (rate unknown) we keep native rather than guess.
      if (probe.sampleRate > MAX_STORED_SAMPLE_RATE) {
        cmd.audioFrequency(MAX_STORED_SAMPLE_RATE)
      }
      cmd
        .output(outPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    const flac = await readFile(outPath)
    // The encoder's own sample count is exact and needs no ffprobe — prefer it.
    const info = parseFlacStreamInfo(flac.subarray(0, 42))
    const durationMs = info && info.totalSamples > 0
      ? Math.round((info.totalSamples / info.sampleRate) * 1000)
      : probe.durationMs
    if (opts.maxDurationMs && durationMs > opts.maxDurationMs) {
      throw new AudioTooLongError(durationMs)
    }
    return { flac, durationMs }
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
  const outPath = path.join(tmpdir(), `${randomUUID()}.wav`)
  try {
    await flacToWavFile(flacBuffer, outPath, delayMs)
    return await readFile(outPath)
  } finally {
    await unlink(outPath).catch(() => {})
  }
}

/**
 * Same conversion as flacToWav, but writes straight to `outPath` and never
 * holds the decoded WAV in memory. 24-bit/48 kHz PCM is ~17 MB per stereo
 * minute (~33 MB at 96 kHz, ~66 MB at 192 kHz — stems keep their native rate),
 * so the buffer-returning variant is only safe for a single short track —
 * bulk paths (stem export) must use this one or they exhaust the function's
 * heap.
 */
export async function flacToWavFile(
  flacBuffer: Buffer,
  outPath: string,
  delayMs = 0,
): Promise<void> {
  const inPath = path.join(tmpdir(), `${randomUUID()}.flac`)
  try {
    await writeFile(inPath, flacBuffer)
    await flacFileToWavFile(inPath, outPath, delayMs)
  } finally {
    await unlink(inPath).catch(() => {})
  }
}

/**
 * The file→file form of the same conversion: nothing about the track passes
 * through the heap. Pair it with `streamR2ObjectToFile` when the source is in
 * R2 (bulk stem export) so neither the FLAC nor the WAV is ever buffered.
 * The caller owns `inPath`.
 *
 * The WAV keeps the FLAC's native sample rate and bit depth: 16-bit sources
 * come back as 16-bit, everything else as 24-bit (FLAC tops out at 24 here).
 */
export async function flacFileToWavFile(
  inPath: string,
  outPath: string,
  delayMs = 0,
): Promise<void> {
  ensureFfmpegConfigured()

  const info = await readFlacStreamInfo(inPath)
  const codec = info && info.bitsPerSample <= 16 ? 'pcm_s16le' : 'pcm_s24le'

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(inPath).audioCodec(codec)

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
}

// ─── Streaming encode to FLAC (no /tmp, no heap) ─────────────────────────────

export interface PcmFormat {
  sampleRate: number
  channels: number
  /** Stored FLAC bit depth: 16 stays 16, anything else is 24 (FLAC ints, see policy above). */
  bits: 16 | 24
}

/**
 * ffprobe a local file — in practice only the first few MB of an upload
 * (`probeAudioFormat` in process), which is enough for the stream parameters.
 * Duration is a best-effort estimate here; the exact length is counted while
 * encoding. Returns null when ffprobe is missing or can't read the input.
 */
export async function probeAudioFormat(
  filePath: string,
): Promise<{ format: PcmFormat; durationMs: number } | null> {
  ensureFfmpegConfigured()
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return resolve(null)
      const st = meta?.streams?.find(x => x.codec_type === 'audio')
      const sampleRate = Number(st?.sample_rate ?? 0)
      const channels = Number(st?.channels ?? 0)
      if (!st || !sampleRate || !channels) return resolve(null)
      const fmt = String(st.sample_fmt ?? '')
      const raw = Number(st.bits_per_raw_sample ?? 0) || Number(st.bits_per_sample ?? 0)
      const is16 = /^(u8|s16)p?$/.test(fmt) || (/^s32p?$/.test(fmt) && raw > 0 && raw <= 16)
      resolve({
        format: {
          sampleRate: Math.min(sampleRate, MAX_STORED_SAMPLE_RATE),
          channels,
          bits: is16 ? 16 : 24,
        },
        durationMs: Math.round(Number(meta?.format?.duration ?? 0) * 1000) || 0,
      })
    })
  })
}

/**
 * Decode → count → encode, as two ffmpeg processes joined through Node:
 *
 *   source ─▶ ffmpeg #1 (decodeArgs → raw s32le PCM) ─▶ counter ─▶ ffmpeg #2 (FLAC) ─▶ stream
 *
 * Why two processes: a FLAC written to a pipe can't have its STREAMINFO
 * rewritten at the end, so the header would carry no sample count — and
 * downloads, export and edits rely on it (`flacStreamToWav`). Counting the PCM
 * between the processes gives the exact count; `patchStreamInfo` writes it into
 * the header, which the uploader holds back until the end
 * (`uploadStreamToR2(..., { finalizeHead })`).
 *
 * Every failure mode surfaces as a throw from `stream` before it finishes —
 * either process exiting non-zero, the source erroring, a torn PCM frame,
 * or the length cap (`AudioTooLongError`, checked live so a 3-hour MP3 is cut
 * off after 20 minutes of decoding, not after all of it). The consumer
 * (uploader) then aborts, so nothing partial is ever published.
 */
export function encodeFlacStream(opts: {
  /** Fed to ffmpeg #1's stdin; null when decodeArgs read from elsewhere. */
  source: Readable | null
  /** ffmpeg #1 input + filter args, e.g. ['-i', 'pipe:0']. Output format is added here. */
  decodeArgs: string[]
  /** Output format. ffmpeg #1 is told to produce exactly this rate/channel count. */
  format: PcmFormat
  /** Cap on decoded length in frames (samples per channel). */
  maxFrames?: number
}): {
  stream: AsyncGenerator<Buffer>
  patchStreamInfo: (head: Buffer) => void
  frames: () => number
} {
  ensureFfmpegConfigured()
  const { source, decodeArgs, format, maxFrames } = opts
  const frameBytes = 4 * format.channels
  let pcmBytes = 0
  let finished = false

  const decodeCmd = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...decodeArgs,
    '-vn', '-sn', '-dn',
    '-ar', String(format.sampleRate), '-ac', String(format.channels),
    '-f', 's32le', '-acodec', 'pcm_s32le', 'pipe:1',
  ]
  const encodeCmd = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 's32le', '-ar', String(format.sampleRate), '-ac', String(format.channels), '-i', 'pipe:0',
    '-c:a', 'flac',
    ...(format.bits === 16 ? ['-sample_fmt', 's16'] : ['-sample_fmt', 's32', '-bits_per_raw_sample', '24']),
    '-f', 'flac', 'pipe:1',
  ]

  async function* run(): AsyncGenerator<Buffer> {
    const dec = spawn(resolvedFfmpegPath!, decodeCmd, { stdio: ['pipe', 'pipe', 'pipe'] })
    const enc = spawn(resolvedFfmpegPath!, encodeCmd, { stdio: ['pipe', 'pipe', 'pipe'] })
    let decErr = ''
    let encErr = ''
    dec.stderr.on('data', (d: Buffer) => { if (decErr.length < 4000) decErr += d.toString() })
    enc.stderr.on('data', (d: Buffer) => { if (encErr.length < 4000) encErr += d.toString() })
    const exit = (cp: typeof dec) => new Promise<number | null>((resolve, reject) => {
      cp.on('error', reject)
      cp.on('close', code => resolve(code))
    })
    const decExit = exit(dec)
    const encExit = exit(enc)

    let failure: unknown = null
    const fail = (err: unknown) => {
      failure ??= err
      dec.kill('SIGKILL')
      enc.kill('SIGKILL')
    }

    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        pcmBytes += chunk.length
        if (maxFrames && pcmBytes / frameBytes > maxFrames) {
          const err = new AudioTooLongError(Math.round((pcmBytes / frameBytes / format.sampleRate) * 1000))
          fail(err)
          return cb(err)
        }
        cb(null, chunk)
      },
    })
    counter.on('error', () => {}) // reported through `failure`
    dec.stdin.on('error', () => {})
    enc.stdin.on('error', () => {})
    dec.stdout.pipe(counter).pipe(enc.stdin)

    if (source) {
      source.on('error', err => fail(err))
      source.pipe(dec.stdin)
    } else {
      dec.stdin.end()
    }

    try {
      for await (const chunk of enc.stdout as AsyncIterable<Buffer>) {
        if (failure) break
        yield chunk
      }
      const [decCode, encCode] = await Promise.all([decExit, encExit])
      if (failure) throw failure
      if (decCode !== 0) throw new Error(`ffmpeg decode exited ${decCode}: ${decErr.trim()}`)
      if (encCode !== 0) throw new Error(`ffmpeg encode exited ${encCode}: ${encErr.trim()}`)
      if (pcmBytes % frameBytes !== 0) throw new Error('Decoded PCM ends mid-frame')
      if (pcmBytes === 0) throw new Error('No audio decoded')
      finished = true
    } finally {
      if (dec.exitCode === null) dec.kill('SIGKILL')
      if (enc.exitCode === null) enc.kill('SIGKILL')
      if (source) {
        source.unpipe(dec.stdin)
        source.destroy()
      }
    }
  }

  return {
    stream: run(),
    frames: () => pcmBytes / frameBytes,
    patchStreamInfo(head: Buffer) {
      if (!finished) throw new Error('patchStreamInfo before the encode finished')
      const info = parseFlacStreamInfo(head)
      if (!info) throw new Error('Encoder output has no STREAMINFO header')
      if (info.sampleRate !== format.sampleRate || info.channels !== format.channels) {
        throw new Error(`STREAMINFO ${info.sampleRate}/${info.channels} != ${format.sampleRate}/${format.channels}`)
      }
      const total = pcmBytes / frameBytes
      if (total >= 2 ** 36) throw new Error('Too many samples for STREAMINFO')
      // 36-bit total-samples field: low nibble of byte 21, then bytes 22–25.
      head[21] = (head[21] & 0xf0) | (Math.floor(total / 2 ** 32) & 0x0f)
      head.writeUInt32BE(total % 2 ** 32, 22)
    },
  }
}

// ─── Mixing stems streamed from R2 ────────────────────────────────────────────

/**
 * Mix N audio streams with one ffmpeg run, without staging them anywhere:
 * input i is fed through the child's file descriptor 3+i (`-i pipe:3`, …),
 * straight from its R2 stream. Memory and /tmp stay flat no matter how many
 * or how long the stems are — previously every stem was downloaded into the
 * heap at once and written to /tmp before mixing.
 *
 * `filterGraph` addresses inputs as `[0:a]`, `[1:a]`, … and must produce
 * `[out]`. The result is written to `outPath` (an MP3 — small).
 */
export async function mixStreamsToMp3(opts: {
  inputs: Readable[]
  filterGraph: string
  outPath: string
  bitrate: string
}): Promise<void> {
  ensureFfmpegConfigured()
  const { inputs, filterGraph, outPath, bitrate } = opts
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...inputs.flatMap((_, i) => ['-i', `pipe:${3 + i}`]),
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-c:a', 'libmp3lame', '-b:a', bitrate,
    '-ac', '2', '-ar', String(MIX_OUTPUT_SAMPLE_RATE),
    outPath,
  ]
  const child = spawn(resolvedFfmpegPath!, args, {
    stdio: ['ignore', 'ignore', 'pipe', ...inputs.map(() => 'pipe' as const)],
  })
  let stderr = ''
  child.stderr!.on('data', (d: Buffer) => { if (stderr.length < 4000) stderr += d.toString() })

  let failure: unknown = null
  inputs.forEach((src, i) => {
    const fd = child.stdio[3 + i] as NodeJS.WritableStream & { on: (e: string, f: () => void) => void }
    fd.on('error', () => {}) // ffmpeg closing an input early shows up in its exit code
    src.on('error', err => { failure ??= err; child.kill('SIGKILL') })
    src.pipe(fd)
  })

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', c => resolve(c))
    })
    if (failure) throw failure
    if (code !== 0) throw new Error(`ffmpeg mix exited ${code}: ${stderr.trim()}`)
  } finally {
    for (const src of inputs) src.destroy()
  }
}

// ─── Streaming FLAC → WAV (no /tmp, no heap) ──────────────────────────────────

/** Frames of tolerated rounding slack between the computed and the decoded length. */
const WAV_LENGTH_SLACK_FRAMES = 1024

function wavHeader(opts: {
  sampleRate: number
  channels: number
  bits: 16 | 24
  dataBytes: number
}): Buffer {
  const { sampleRate, channels, bits, dataBytes } = opts
  const blockAlign = channels * (bits / 8)
  // WAVE_FORMAT_EXTENSIBLE for >16-bit or >2 channels (what ffmpeg itself writes).
  const extensible = bits > 16 || channels > 2
  const fmtLen = extensible ? 40 : 16
  const header = Buffer.alloc(12 + 8 + fmtLen + 8)
  let o = 0
  header.write('RIFF', o); o += 4
  // RIFF chunks are word-aligned: an odd data size gets one pad byte after it.
  header.writeUInt32LE(4 + 8 + fmtLen + 8 + dataBytes + (dataBytes & 1), o); o += 4
  header.write('WAVE', o); o += 4
  header.write('fmt ', o); o += 4
  header.writeUInt32LE(fmtLen, o); o += 4
  header.writeUInt16LE(extensible ? 0xfffe : 1, o); o += 2
  header.writeUInt16LE(channels, o); o += 2
  header.writeUInt32LE(sampleRate, o); o += 4
  header.writeUInt32LE(sampleRate * blockAlign, o); o += 4
  header.writeUInt16LE(blockAlign, o); o += 2
  header.writeUInt16LE(bits, o); o += 2
  if (extensible) {
    header.writeUInt16LE(22, o); o += 2 // cbSize
    header.writeUInt16LE(bits, o); o += 2 // valid bits
    header.writeUInt32LE(channels === 1 ? 0x4 : channels === 2 ? 0x3 : 0, o); o += 4
    // KSDATAFORMAT_SUBTYPE_PCM 00000001-0000-0010-8000-00aa00389b71
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(header, o); o += 16
  }
  header.write('data', o); o += 4
  header.writeUInt32LE(dataBytes, o)
  return header
}

/**
 * Decode a FLAC stream to WAV as a stream, with the start_bar offset applied
 * (positive delay pads silence, negative trims). Nothing touches /tmp and only
 * pipe-sized chunks are in memory, so length is unbounded.
 *
 * The WAV header has to state the data size up front, and a pipe can't be
 * seeked back to fix it — so the size is computed from STREAMINFO
 * (`totalSamples`, which every FLAC written by our pipeline carries) and the
 * output is held to exactly that many bytes. A shortfall beyond a few samples
 * of rounding means a truncated decode and throws instead of padding — the
 * caller's upload is aborted and nothing is published.
 *
 * Throws synchronously-ish (rejects on first read) when STREAMINFO has no
 * sample count; callers should check `info.totalSamples` and fall back to the
 * file-based `flacFileToWavFile`.
 */
export function flacStreamToWav(
  source: Readable,
  info: FlacStreamInfo,
  delayMs = 0,
): { stream: AsyncGenerator<Buffer>; byteLength: number } {
  if (!info.totalSamples) throw new Error('FLAC has no sample count in STREAMINFO')
  ensureFfmpegConfigured()

  const bits: 16 | 24 = info.bitsPerSample <= 16 ? 16 : 24
  const fmt = bits === 16 ? 's16le' : 's24le'
  const frameBytes = info.channels * (bits / 8)
  const offsetFrames = Math.round((delayMs * info.sampleRate) / 1000)
  const outFrames = offsetFrames >= 0
    ? info.totalSamples + offsetFrames
    : Math.max(0, info.totalSamples + offsetFrames)
  const dataBytes = outFrames * frameBytes
  const header = wavHeader({ sampleRate: info.sampleRate, channels: info.channels, bits, dataBytes })
  const padByte = dataBytes & 1
  if (header.length - 8 + dataBytes + padByte > 0xffffffff) {
    throw new Error('WAV would exceed 4 GB (RIFF limit)')
  }

  const filters = offsetFrames > 0
    ? ['-af', `adelay=delays=${offsetFrames}S:all=1`]
    : offsetFrames < 0
      ? ['-af', `atrim=start_sample=${-offsetFrames},asetpts=PTS-STARTPTS`]
      : []
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'flac', '-i', 'pipe:0',
    ...filters,
    '-f', fmt, '-acodec', `pcm_${fmt}`,
    'pipe:1',
  ]

  async function* run(): AsyncGenerator<Buffer> {
    const child = spawn(resolvedFfmpegPath!, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => { if (stderr.length < 4000) stderr += d.toString() })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => resolve(code))
    })
    let sourceError: unknown = null
    source.on('error', err => { sourceError = err; child.kill('SIGKILL') })
    // ffmpeg may stop reading early (e.g. on a decode error) — that's reported
    // through its exit code, not as an unhandled EPIPE.
    child.stdin.on('error', () => {})
    source.pipe(child.stdin)

    const slackBytes = WAV_LENGTH_SLACK_FRAMES * frameBytes
    let emitted = 0
    let excess = 0
    try {
      yield header
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        const room = dataBytes - emitted
        const out = chunk.length > room ? chunk.subarray(0, Math.max(0, room)) : chunk
        excess += chunk.length - out.length
        if (excess > slackBytes) throw new Error('Decoded audio longer than STREAMINFO states')
        if (out.length === 0) continue
        emitted += out.length
        yield out
      }
      const code = await exited
      if (sourceError) throw sourceError
      if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.trim()}`)
      const missing = dataBytes - emitted
      if (missing > WAV_LENGTH_SLACK_FRAMES * frameBytes) {
        throw new Error(`Decoded audio ${missing} bytes short of STREAMINFO length`)
      }
      if (missing > 0) yield Buffer.alloc(missing) // rounding slack only
      if (padByte) yield Buffer.alloc(1)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      source.unpipe(child.stdin)
      source.destroy()
    }
  }

  return { stream: run(), byteLength: header.length + dataBytes + padByte }
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
 *
 * Streaming: `source` is the stored FLAC straight from R2 (stdin), the result
 * is an `encodeFlacStream` for `uploadStreamToR2` — nothing on /tmp. Rendered
 * at the source's native rate and bit depth, always stereo.
 *
 * Memory note: the source is read once and fanned out with asplit. Clips that
 * play in source order stream through; material that is reordered or
 * duplicated (a later clip taking audio from earlier in the source) is held in
 * ffmpeg's memory until its slot comes up.
 */
export function renderEditedFlacStream(
  source: Readable,
  /** STREAMINFO of the source FLAC (rate, bit depth, exact length). */
  srcInfo: FlacStreamInfo,
  segments: RenderEditSegment[],
  barDurSec: number,
): { encoder: ReturnType<typeof encodeFlacStream>; durationMs: number } {
  const rate = srcInfo.sampleRate || FALLBACK_SAMPLE_RATE
  const bits: 16 | 24 = srcInfo.bitsPerSample <= 16 ? 16 : 24
  const sampleFmt = bits === 16 ? 's16' : 's32'
  const FMT = `aformat=sample_fmts=${sampleFmt}:sample_rates=${rate}:channel_layouts=stereo`
  // Exact source length from STREAMINFO; 0 = unknown (treat every clip as audible).
  const sourceDurSec = srcInfo.totalSamples > 0 ? srcInfo.totalSamples / rate : 0
  const sourceDurKnown = sourceDurSec > 0

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
      // When the source duration is known, a clip starting past EOF is pure
      // silence. When it's unknown, assume it's audible (atrim will stop at the
      // real EOF and apad backfills the slot) rather than silencing everything.
      const audibleSec = sourceDurKnown
        ? Math.min(slotSec, Math.max(0, sourceDurSec - srcStartSec))
        : slotSec
      if (audibleSec <= 0.001) {
        pieces.push({ kind: 'silence', durSec: slotSec })
      } else {
        pieces.push({ kind: 'clip', startSec: srcStartSec, endSec: srcStartSec + audibleSec, slotSec })
      }
      cursorBar += clip.lenBars
    }
  }
  if (pieces.length === 0) throw new Error('Nothing to render')

  const totalDurSec = pieces.reduce(
    (sum, p) => sum + (p.kind === 'silence' ? p.durSec : p.slotSec),
    0,
  )

  // A filter input pad can only be consumed once — asplit the source when
  // several pieces slice it.
  const clipCount = pieces.filter(p => p.kind === 'clip').length
  const filters: string[] = []
  if (clipCount > 1) {
    filters.push(
      `[0:a]asplit=${clipCount}${Array.from({ length: clipCount }, (_, i) => `[in${i}]`).join('')}`,
    )
  } else if (clipCount === 0) {
    // All silence: the source still has to be consumed (it's on stdin), so
    // route it into a sink that discards it.
    filters.push('[0:a]anullsink')
  }

  const labels: string[] = []
  let clipIdx = 0
  pieces.forEach((piece, i) => {
    const label = `p${i}`
    if (piece.kind === 'silence') {
      filters.push(
        `anullsrc=r=${rate}:cl=stereo,atrim=duration=${piece.durSec.toFixed(6)},${FMT}[${label}]`,
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

  const encoder = encodeFlacStream({
    source,
    decodeArgs: ['-f', 'flac', '-i', 'pipe:0', '-filter_complex', filters.join(';'), '-map', '[out]'],
    format: { sampleRate: rate, channels: 2, bits },
  })
  return { encoder, durationMs: Math.round(totalDurSec * 1000) }
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

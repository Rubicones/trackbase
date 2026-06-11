import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'

function resolveFfmpegPath(): string {
  // 1. ffmpeg-static (bundled binary)
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic

  // 2. System ffmpeg (e.g. installed via `brew install ffmpeg`)
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

ffmpeg.setFfmpegPath(resolveFfmpegPath())

export async function audioToFlac(
  buffer: Buffer,
  inputFormat: 'wav' | 'mp3'
): Promise<{ flac: Buffer; durationMs: number }> {
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

export async function flacToWav(flacBuffer: Buffer): Promise<Buffer> {
  const id = randomUUID()
  const inPath = path.join(tmpdir(), `${id}.flac`)
  const outPath = path.join(tmpdir(), `${id}.wav`)

  try {
    await writeFile(inPath, flacBuffer)
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .audioCodec('pcm_s24le')
        .audioFrequency(48000)
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

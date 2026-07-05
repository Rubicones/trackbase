import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { isValidProjectTimeSignature } from '@/lib/metronomeAudio'
import { clientRateLimitKey, rateLimit } from '@/lib/rate-limit'
import { decodeAudioToPcmFloat32, CHORD_DETECTION_SAMPLE_RATE } from '@/lib/ffmpeg'
import { analyzeChordsAndKey } from '@/lib/serverChordDetection'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const MIN_BPM = 40
const MAX_BPM = 300
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

const EXT_BY_MIMETYPE: Record<string, 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a'> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/vorbis': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
}

function extFromFilename(filename: string): 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.mp3')) return 'mp3'
  if (lower.endsWith('.wav')) return 'wav'
  if (lower.endsWith('.flac')) return 'flac'
  if (lower.endsWith('.ogg')) return 'ogg'
  if (lower.endsWith('.m4a')) return 'm4a'
  return null
}

function resolveAudioExt(filename: string, mimetype: string): 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | null {
  return EXT_BY_MIMETYPE[mimetype] ?? extFromFilename(filename)
}

/** Only what the privacy note in the spec allows — never filenames, never chord results. */
function logRequest(fields: {
  hashedIp: string
  fileSize?: number
  durationSeconds?: number
  status: 'success' | 'error'
  reason?: string
}) {
  console.log('[chord-detector]', {
    timestamp: new Date().toISOString(),
    ip_hash: fields.hashedIp,
    file_size: fields.fileSize,
    duration_seconds: fields.durationSeconds,
    status: fields.status,
    ...(fields.reason ? { reason: fields.reason } : {}),
  })
}

export async function POST(req: NextRequest) {
  const rateLimitKey = clientRateLimitKey(req, 'chord-detector')
  const hashedIp = createHash('sha256').update(rateLimitKey).digest('hex').slice(0, 16)

  const rl = rateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
  if (!rl.ok) {
    logRequest({ hashedIp, status: 'error', reason: 'rate_limited' })
    return NextResponse.json(
      {
        error:
          "You've reached the limit of 5 analyses per hour. Come back later or sign up for unlimited access.",
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    logRequest({ hashedIp, status: 'error', reason: 'form_parse_failed' })
    return NextResponse.json({ error: 'Failed to read the upload. Please try again.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const bpmRaw = formData.get('bpm')
  const timeSignatureRaw = formData.get('time_signature')
  const timeSignature =
    typeof timeSignatureRaw === 'string' && timeSignatureRaw.trim()
      ? timeSignatureRaw.trim()
      : '4/4'

  if (!file) {
    logRequest({ hashedIp, status: 'error', reason: 'missing_file' })
    return NextResponse.json({ error: 'Please choose an audio file.' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    logRequest({ hashedIp, fileSize: file.size, status: 'error', reason: 'file_too_large' })
    return NextResponse.json(
      { error: 'This file is too large. Please upload a file under 10 MB.' },
      { status: 400 },
    )
  }

  const ext = resolveAudioExt(file.name, file.type)
  if (!ext) {
    logRequest({ hashedIp, fileSize: file.size, status: 'error', reason: 'unsupported_format' })
    return NextResponse.json(
      { error: 'Unsupported file type. Please use MP3, WAV, FLAC, OGG, or M4A.' },
      { status: 400 },
    )
  }

  const bpm = Number(bpmRaw)
  if (!bpmRaw || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) {
    logRequest({ hashedIp, fileSize: file.size, status: 'error', reason: 'invalid_bpm' })
    return NextResponse.json(
      { error: `Please enter the track BPM (between ${MIN_BPM} and ${MAX_BPM}).` },
      { status: 400 },
    )
  }

  if (!isValidProjectTimeSignature(timeSignature)) {
    logRequest({ hashedIp, fileSize: file.size, status: 'error', reason: 'invalid_time_signature' })
    return NextResponse.json(
      { error: 'Unsupported time signature. Please choose one from the list.' },
      { status: 400 },
    )
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())

    // Decode + analyze fully in memory / temp files that are deleted before this returns.
    // Nothing about the file itself (bytes, name, or chord results) is persisted or logged.
    const { pcm, durationSeconds } = await decodeAudioToPcmFloat32(buffer, ext)
    const analysis = analyzeChordsAndKey(pcm, CHORD_DETECTION_SAMPLE_RATE, bpm, durationSeconds, timeSignature)

    logRequest({ hashedIp, fileSize: file.size, durationSeconds: analysis.duration_seconds, status: 'success' })

    return NextResponse.json(analysis)
  } catch (err) {
    logRequest({
      hashedIp,
      fileSize: file.size,
      status: 'error',
      reason: err instanceof Error ? err.message : 'unknown_error',
    })
    return NextResponse.json(
      { error: 'Something went wrong during analysis. Please try again or try a different file.' },
      { status: 500 },
    )
  }
}

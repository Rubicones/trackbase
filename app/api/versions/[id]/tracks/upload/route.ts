import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'
import { uploadToR2, r2Key } from '@/lib/r2'
import { audioToFlac } from '@/lib/ffmpeg'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { logActivity, fmtFileSize } from '@/lib/activity'
import { parseMidiFile, midiDurationMs } from '@/lib/midi'
import { randomTrackIconColor } from '@/lib/trackIcon'

const ALLOWED_AUDIO_MIMETYPES: Record<string, 'wav' | 'mp3'> = {
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg':  'mp3',
  'audio/mp3':   'mp3',
}

const MIDI_MIMETYPES = new Set([
  'audio/midi',
  'audio/x-midi',
  'audio/mid',
  'application/x-midi',
])

function isMidiFile(filename: string, mimetype: string): boolean {
  return (
    filename.endsWith('.mid') ||
    filename.endsWith('.midi') ||
    MIDI_MIMETYPES.has(mimetype)
  )
}

function isAudioFile(filename: string, mimetype: string): boolean {
  return (
    mimetype in ALLOWED_AUDIO_MIMETYPES ||
    filename.endsWith('.wav') ||
    filename.endsWith('.mp3')
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: versionId } = await params
  console.log('[upload] versionId:', versionId)

  // 1. Verify version and enforce band membership
  const access = await requireBandMemberForVersion(req, versionId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
  const { userId, version } = access
  console.log('[upload] version ok, project_id:', version.project_id)

  // 2. Parse form
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    console.error('[upload] formData parse failed:', err)
    return NextResponse.json({ error: 'Failed to parse form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const trackName = formData.get('name') as string | null
  const position = parseInt((formData.get('position') as string) ?? '0', 10)
  const midiStartBar = parseInt((formData.get('midi_start_bar') as string) ?? '0', 10)
  console.log('[upload] file:', file?.name, file?.type, file?.size, '| name:', trackName, '| position:', position, '| midiStartBar:', midiStartBar)

  if (!file || !trackName) {
    return NextResponse.json({ error: 'file and name are required' }, { status: 400 })
  }

  // 3. Detect file type
  const filename = file.name
  const mimetype = file.type

  if (isMidiFile(filename, mimetype)) {
    return handleMidiUpload({ file, trackName, position, midiStartBar, versionId, version, userId })
  } else if (isAudioFile(filename, mimetype)) {
    const inputFormat = ALLOWED_AUDIO_MIMETYPES[mimetype] ?? (filename.endsWith('.mp3') ? 'mp3' : 'wav')
    return handleAudioUpload({ file, trackName, position, versionId, version, userId, inputFormat })
  } else {
    console.error('[upload] unsupported file type:', mimetype, filename)
    return NextResponse.json(
      { error: `Unsupported file type: "${mimetype}". Allowed: WAV, MP3, MID` },
      { status: 400 }
    )
  }
}

// ─── Audio upload (existing flow) ─────────────────────────────────────────────

async function handleAudioUpload({
  file, trackName, position, versionId, version, userId, inputFormat,
}: {
  file: File
  trackName: string
  position: number
  versionId: string
  version: { id: string; project_id: string }
  userId: string | null
  inputFormat: 'wav' | 'mp3'
}) {
  // Read buffer + hash
  let audioBuffer: Buffer
  try {
    audioBuffer = Buffer.from(await file.arrayBuffer())
  } catch (err) {
    console.error('[upload] arrayBuffer read failed:', err)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
  const fileHash = createHash('sha256').update(audioBuffer).digest('hex')
  console.log('[upload] fileHash:', fileHash, '| size:', audioBuffer.byteLength)

  // Dedup check
  const { data: existing } = await supabase
    .from('tracks')
    .select('storage_path, duration_ms, file_size_bytes')
    .eq('file_hash', fileHash)
    .limit(1)
    .maybeSingle()

  let storagePath: string
  let fileSizeBytes: number
  let audioDurationMs: number = existing?.duration_ms ?? 0

  if (existing) {
    storagePath = existing.storage_path
    fileSizeBytes = existing.file_size_bytes ?? audioBuffer.byteLength
    console.log('[upload] dedup hit — reusing', storagePath)
  } else {
    let flacBuffer: Buffer
    try {
      console.log('[upload] converting to FLAC...')
      const result = await audioToFlac(audioBuffer, inputFormat)
      flacBuffer = result.flac
      audioDurationMs = result.durationMs
      console.log('[upload] FLAC done, size:', flacBuffer.byteLength, 'duration:', audioDurationMs, 'ms')
    } catch (err) {
      console.error('[upload] ffmpeg conversion failed:', err)
      return NextResponse.json({ error: 'Audio conversion failed', detail: String(err) }, { status: 500 })
    }
    storagePath = r2Key(version.project_id, fileHash)
    try {
      await uploadToR2(storagePath, flacBuffer)
    } catch (err) {
      console.error('[upload] R2 upload failed:', err)
      return NextResponse.json({ error: 'Storage upload failed', detail: String(err) }, { status: 500 })
    }
    fileSizeBytes = flacBuffer.byteLength
  }

  const { data: track, error: trkErr } = await supabase
    .from('tracks')
    .insert({
      version_id: versionId,
      name: trackName,
      original_filename: file.name,
      file_hash: fileHash,
      storage_path: storagePath,
      file_size_bytes: fileSizeBytes,
      duration_ms: audioDurationMs || null,
      position,
      file_type: 'audio',
      icon_color: randomTrackIconColor(),
    })
    .select()
    .single()
  if (trkErr) {
    console.error('[upload] track insert failed:', trkErr)
    return NextResponse.json({ error: 'DB insert failed', detail: trkErr.message }, { status: 500 })
  }

  console.log('[upload] done, track id:', track.id)

  supabase
    .from('projects').select('id, band_id').eq('id', version.project_id).maybeSingle()
    .then(({ data: proj }) => {
      if (proj) logActivity({
        bandId: proj.band_id, userId, action: 'upload',
        subject: file.name, detail: fmtFileSize(fileSizeBytes),
        projectId: proj.id,
      })
    })

  return NextResponse.json({ track }, { status: 201 })
}

// ─── MIDI upload ──────────────────────────────────────────────────────────────

async function handleMidiUpload({
  file, trackName, position, midiStartBar, versionId, version, userId,
}: {
  file: File
  trackName: string
  position: number
  midiStartBar: number
  versionId: string
  version: { id: string; project_id: string }
  userId: string | null
}) {
  console.log('[upload] MIDI file detected')

  // Read buffer + hash
  let midiBuffer: Buffer
  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
    midiBuffer = Buffer.from(arrayBuffer)
  } catch (err) {
    console.error('[upload] arrayBuffer read failed:', err)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
  const fileHash = createHash('sha256').update(midiBuffer).digest('hex')
  console.log('[upload] MIDI fileHash:', fileHash, '| size:', midiBuffer.byteLength)

  // Parse MIDI to extract metadata
  let midiData
  try {
    midiData = parseMidiFile(arrayBuffer)
    console.log('[upload] MIDI parsed:', midiData.notes.length, 'notes, bpm:', midiData.bpm)
  } catch (err) {
    console.error('[upload] MIDI parse failed:', err)
    return NextResponse.json({ error: 'Failed to parse MIDI file', detail: String(err) }, { status: 400 })
  }

  const durationMs = Math.round(midiDurationMs(midiData))

  // Dedup check
  const { data: existing } = await supabase
    .from('tracks')
    .select('storage_path, duration_ms, file_size_bytes')
    .eq('file_hash', fileHash)
    .limit(1)
    .maybeSingle()

  let storagePath: string

  if (existing) {
    storagePath = existing.storage_path
    console.log('[upload] MIDI dedup hit — reusing', storagePath)
  } else {
    // Store raw .mid file in R2
    storagePath = `projects/${version.project_id}/${fileHash}.mid`
    try {
      console.log('[upload] uploading MIDI to R2:', storagePath)
      await uploadToR2(storagePath, midiBuffer, 'audio/midi')
      console.log('[upload] R2 MIDI upload ok')
    } catch (err) {
      console.error('[upload] R2 upload failed:', err)
      return NextResponse.json({ error: 'Storage upload failed', detail: String(err) }, { status: 500 })
    }
  }

  const { data: track, error: trkErr } = await supabase
    .from('tracks')
    .insert({
      version_id: versionId,
      name: trackName,
      original_filename: file.name,
      file_hash: fileHash,
      storage_path: storagePath,
      file_size_bytes: midiBuffer.byteLength,
      duration_ms: durationMs,
      position,
      file_type: 'midi',
      midi_data: midiData,
      midi_start_bar: isNaN(midiStartBar) ? 0 : Math.max(0, midiStartBar),
      start_bar: isNaN(midiStartBar) ? 0 : Math.max(0, midiStartBar),
      icon_color: randomTrackIconColor(),
    })
    .select()
    .single()
  if (trkErr) {
    console.error('[upload] MIDI track insert failed:', trkErr)
    return NextResponse.json({ error: 'DB insert failed', detail: trkErr.message }, { status: 500 })
  }

  console.log('[upload] MIDI done, track id:', track.id)

  supabase
    .from('projects').select('id, band_id').eq('id', version.project_id).maybeSingle()
    .then(({ data: proj }) => {
      if (proj) logActivity({
        bandId: proj.band_id, userId, action: 'upload',
        subject: file.name, detail: `${midiData.notes.length} notes`,
        projectId: proj.id,
      })
    })

  return NextResponse.json({ track }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabase } from '@/lib/supabase'
import { uploadToR2, r2Key } from '@/lib/r2'
import { audioToFlac } from '@/lib/ffmpeg'

const ALLOWED_MIMETYPES: Record<string, 'wav' | 'mp3'> = {
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg':  'mp3',
  'audio/mp3':   'mp3',
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: versionId } = await params
  console.log('[upload] versionId:', versionId)

  // 1. Verify version
  const { data: version, error: verErr } = await supabase
    .from('versions')
    .select('id, project_id')
    .eq('id', versionId)
    .single()
  if (verErr) {
    console.error('[upload] version lookup failed:', verErr)
    return NextResponse.json({ error: 'Version not found' }, { status: 404 })
  }
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
  console.log('[upload] file:', file?.name, file?.type, file?.size, '| name:', trackName, '| position:', position)

  if (!file || !trackName) {
    return NextResponse.json({ error: 'file and name are required' }, { status: 400 })
  }

  // 3. Validate mimetype
  const inputFormat = ALLOWED_MIMETYPES[file.type]
  if (!inputFormat) {
    console.error('[upload] unsupported mimetype:', file.type)
    return NextResponse.json(
      { error: `Unsupported file type: "${file.type}". Allowed: WAV, MP3` },
      { status: 400 }
    )
  }
  console.log('[upload] inputFormat:', inputFormat)

  // 4. Read buffer + hash
  let audioBuffer: Buffer
  try {
    audioBuffer = Buffer.from(await file.arrayBuffer())
  } catch (err) {
    console.error('[upload] arrayBuffer read failed:', err)
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 })
  }
  const fileHash = createHash('sha256').update(audioBuffer).digest('hex')
  console.log('[upload] fileHash:', fileHash, '| size:', audioBuffer.byteLength)

  // 5. Dedup check
  const { data: existing, error: dedupErr } = await supabase
    .from('tracks')
    .select('storage_path, duration_ms, file_size_bytes')
    .eq('file_hash', fileHash)
    .limit(1)
    .maybeSingle()
  if (dedupErr) console.warn('[upload] dedup query error (non-fatal):', dedupErr)
  console.log('[upload] existing:', existing ? existing.storage_path : 'none')

  let storagePath: string
  let fileSizeBytes: number

  if (existing) {
    storagePath = existing.storage_path
    fileSizeBytes = existing.file_size_bytes ?? audioBuffer.byteLength
    console.log('[upload] dedup hit — reusing', storagePath)
  } else {
    // 6. Convert to FLAC
    let flacBuffer: Buffer
    try {
      console.log('[upload] converting to FLAC...')
      flacBuffer = await audioToFlac(audioBuffer, inputFormat)
      console.log('[upload] FLAC done, size:', flacBuffer.byteLength)
    } catch (err) {
      console.error('[upload] ffmpeg conversion failed:', err)
      return NextResponse.json({ error: 'Audio conversion failed', detail: String(err) }, { status: 500 })
    }

    // 7. Upload to R2
    storagePath = r2Key(version.project_id, fileHash)
    try {
      console.log('[upload] uploading to R2:', storagePath)
      await uploadToR2(storagePath, flacBuffer)
      console.log('[upload] R2 upload ok')
    } catch (err) {
      console.error('[upload] R2 upload failed:', err)
      return NextResponse.json({ error: 'Storage upload failed', detail: String(err) }, { status: 500 })
    }
    fileSizeBytes = flacBuffer.byteLength
  }

  // 8. Insert track record
  const { data: track, error: trkErr } = await supabase
    .from('tracks')
    .insert({
      version_id: versionId,
      name: trackName,
      original_filename: file.name,
      file_hash: fileHash,
      storage_path: storagePath,
      file_size_bytes: fileSizeBytes,
      position,
    })
    .select()
    .single()
  if (trkErr) {
    console.error('[upload] track insert failed:', trkErr)
    return NextResponse.json({ error: 'DB insert failed', detail: trkErr.message }, { status: 500 })
  }

  console.log('[upload] done, track id:', track.id)
  return NextResponse.json({ track }, { status: 201 })
}

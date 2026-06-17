/**
 * Server-side preview mix utilities.
 *
 * Provides two public APIs:
 *   markPreviewMixStale(projectId)  — call from any mutation that affects the
 *     rendered audio of main (track add/remove/replace, start_bar change,
 *     bpm/time_signature change, branch merge).
 *
 *   recomputePreviewMix(projectId)  — the heavy ffmpeg work. Called inline for
 *     the first-ever generation ('none' state) and fire-and-forget via after()
 *     for background recomputes ('stale' state).
 *
 * V1 LIMITATION: Only audio tracks (file_type !== 'midi') are rendered into
 * the preview mix. MIDI tracks are skipped. If a project has zero audio tracks
 * this function is a no-op and leaves the project in 'none' status.
 */

import { supabase } from '@/lib/supabase'
import { downloadFromR2, uploadToR2 } from '@/lib/r2'
import { ensureFfmpegConfigured } from '@/lib/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { writeFile, readFile, unlink } from 'fs/promises'
import path from 'path'

// ── Constants ─────────────────────────────────────────────────────────────────

export const PREVIEW_DEBOUNCE_SECONDS = 60
export const PREVIEW_STUCK_LOCK_MS = 5 * 60 * 1000

const previewR2Key = (projectId: string) => `previews/${projectId}/mix.mp3`

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a track's start_bar to milliseconds.
 * Falls back to 4/4 if time_signature is missing.
 */
function startBarToMs(startBar: number, bpm: number, timeSignature: string | null): number {
  const sig = timeSignature ?? '4/4'
  const beatsPerBar = parseInt(sig.split('/')[0], 10) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar
  return Math.round(startBar * barDurationMs)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mark the project's preview mix as stale (audio-affecting mutation happened).
 *
 * - Always updates main_version_modified_at to now.
 * - Flips status from 'fresh' → 'stale'. Does NOT touch 'none', 'stale',
 *   or 'computing' — see spec for rationale on each.
 *
 * Fire-and-forget: errors are logged but not re-thrown so they never break
 * the caller's mutation response.
 */
export async function markPreviewMixStale(projectId: string): Promise<void> {
  try {
    // Unconditionally bump the modification timestamp (used for debounce logic).
    await supabase
      .from('projects')
      .update({ main_version_modified_at: new Date().toISOString() })
      .eq('id', projectId)

    // Flip 'fresh' → 'stale' only. The .eq filter makes this atomic/safe.
    await supabase
      .from('projects')
      .update({ preview_mix_status: 'stale' })
      .eq('id', projectId)
      .eq('preview_mix_status', 'fresh')
  } catch (err) {
    console.error('[previewMix] markPreviewMixStale failed:', err)
  }
}

// ── Core recompute ────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) the cached preview mix for a project.
 *
 * This function performs all the heavy lifting:
 *   1. Fetches audio tracks for main.
 *   2. Builds an ffmpeg adelay + amix filter graph (respecting start_bar offsets).
 *   3. Encodes to MP3 128 kbps stereo.
 *   4. Uploads to R2 at previews/{projectId}/mix.mp3.
 *   5. Updates the project row (fresh/stale based on concurrent-change check).
 *
 * Called synchronously for the 'none' first-generation case, and via after()
 * for background recomputes when the mix is stale.
 *
 * If the project has no audio tracks the function is a no-op. The caller
 * is responsible for having claimed 'computing' status before calling this
 * (for the stale→computing path). For the 'none' path the status is managed
 * here directly.
 */
export async function recomputePreviewMix(projectId: string): Promise<void> {
  // Snapshot the modification time before we start — used later for the
  // concurrent-change check.
  const startedAt = new Date()

  const { data: project } = await supabase
    .from('projects')
    .select('bpm, time_signature, main_version_modified_at')
    .eq('id', projectId)
    .single()

  if (!project) {
    console.error('[previewMix] project not found:', projectId)
    return
  }

  const bpm = project.bpm ?? 120

  // Find main version
  const { data: mainVersion } = await supabase
    .from('versions')
    .select('id')
    .eq('project_id', projectId)
    .eq('type', 'main')
    .maybeSingle()

  if (!mainVersion) {
    console.warn('[previewMix] no main version for project:', projectId)
    return
  }

  // Fetch audio tracks only (skip MIDI — no server-side MIDI renderer in V1)
  const { data: tracks } = await supabase
    .from('tracks')
    .select('id, storage_path, start_bar, file_type')
    .eq('version_id', mainVersion.id)
    .neq('file_type', 'midi')
    .order('position', { ascending: true })

  const audioTracks = (tracks ?? []).filter(t =>
    t.storage_path &&
    !t.storage_path.toLowerCase().endsWith('.mid') &&
    !t.storage_path.toLowerCase().endsWith('.midi')
  )

  if (audioTracks.length === 0) {
    console.log('[previewMix] no audio tracks for project:', projectId)
    // Nothing to render — leave status as-is (GET endpoint handles this).
    return
  }

  const id = randomUUID()
  const tmpPaths: string[] = []
  const outPath = path.join(tmpdir(), `${id}-preview.mp3`)

  try {
    ensureFfmpegConfigured()

    // Download all audio buffers in parallel and write to temp files
    const buffers = await Promise.all(
      audioTracks.map(t => downloadFromR2(t.storage_path))
    )

    for (let i = 0; i < buffers.length; i++) {
      const origExt = audioTracks[i].storage_path.split('.').pop()?.toLowerCase() ?? 'flac'
      const p = path.join(tmpdir(), `${id}-track${i}.${origExt}`)
      await writeFile(p, buffers[i])
      tmpPaths.push(p)
    }

    // Build ffmpeg adelay + amix filter graph
    //
    // Pattern:
    //   [0:a]adelay=delays=<ms>|<ms>[d0]
    //   [1:a]adelay=delays=<ms>|<ms>[d1]
    //   ...
    //   [d0][d1]...amix=inputs=N:duration=longest[out]
    //
    // If a track starts at bar 0 we still apply adelay=0|0 for consistency.
    const delayFilters: string[] = audioTracks.map((t, i) => {
      const delayMs = startBarToMs(t.start_bar ?? 0, bpm, project.time_signature)
      return `[${i}:a]adelay=delays=${delayMs}|${delayMs}[d${i}]`
    })

    const mixInputs = audioTracks.map((_, i) => `[d${i}]`).join('')
    const mixFilter = `${mixInputs}amix=inputs=${audioTracks.length}:duration=longest[out]`

    const filterGraph = [...delayFilters, mixFilter].join(';')

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg()
      for (const p of tmpPaths) cmd.input(p)
      cmd
        .complexFilter(filterGraph)
        .outputOptions(['-map', '[out]'])
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(2)
        .output(outPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })

    // Read mixed output and upload to R2
    const mixedBuffer = await readFile(outPath)
    const storagePath = previewR2Key(projectId)
    await uploadToR2(storagePath, mixedBuffer, 'audio/mpeg')

    console.log(`[previewMix] uploaded ${mixedBuffer.byteLength} bytes to ${storagePath}`)

    // Concurrent-change check: did main_version_modified_at advance since we
    // started? If so, mark stale instead of fresh — the system will converge
    // once edits stop.
    const { data: current } = await supabase
      .from('projects')
      .select('main_version_modified_at')
      .eq('id', projectId)
      .single()

    const modifiedSinceStart = current?.main_version_modified_at &&
      new Date(current.main_version_modified_at) > startedAt

    const finalStatus = modifiedSinceStart ? 'stale' : 'fresh'

    await supabase
      .from('projects')
      .update({
        preview_mix_storage_path: storagePath,
        preview_mix_status: finalStatus,
        preview_mix_generated_at: new Date().toISOString(),
        preview_mix_computing_started_at: null,
      })
      .eq('id', projectId)

    console.log(`[previewMix] recompute done for ${projectId}, status=${finalStatus}`)
  } finally {
    for (const p of tmpPaths) await unlink(p).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

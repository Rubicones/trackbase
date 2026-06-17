/**
 * GET /api/projects/[id]/preview-mix
 *
 * Stale-while-revalidate preview mix endpoint for the quick-play button on
 * the band page (and any other lightweight playback entry point).
 *
 * State machine:
 *   'none'      — no cache exists; generate synchronously, then redirect.
 *   'fresh'     — serve immediately via presigned redirect, no recompute.
 *   'stale'     — serve existing cached file immediately (redirect), and
 *                 conditionally kick off a background recompute via after().
 *   'computing' — serve existing cached file immediately, no new recompute.
 *
 * A stuck-lock safety: 'computing' older than 5 minutes is treated as
 * abandoned and a new recompute is allowed.
 *
 * Response formats:
 *   302  — redirect to a presigned R2 URL for the MP3 (normal case).
 *   422  — project has no audio tracks to preview (first-gen only).
 *   404  — project not found / no main version.
 *   401/403 — unauthorized.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getPresignedDownloadUrl } from '@/lib/r2'
import { requireBandMember } from '@/lib/supabase/server'
import {
  recomputePreviewMix,
  PREVIEW_DEBOUNCE_SECONDS,
  PREVIEW_STUCK_LOCK_MS,
} from '@/lib/previewMix'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Fetch project preview state
  const { data: project } = await supabase
    .from('projects')
    .select('preview_mix_status, preview_mix_storage_path, preview_mix_computing_started_at, main_version_modified_at')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── 'none': no cached file exists — generate synchronously ────────────────

  if (project.preview_mix_status === 'none') {
    // Before generating, verify there are audio tracks to render.
    const { data: mainVersion } = await supabase
      .from('versions')
      .select('id')
      .eq('project_id', projectId)
      .eq('type', 'main')
      .maybeSingle()

    if (!mainVersion) {
      return NextResponse.json({ error: 'No main version found' }, { status: 404 })
    }

    const { data: audioTracks } = await supabase
      .from('tracks')
      .select('id')
      .eq('version_id', mainVersion.id)
      .neq('file_type', 'midi')
      .limit(1)

    if (!audioTracks?.length) {
      return NextResponse.json(
        {
          error: 'NO_AUDIO_TRACKS',
          message: 'This project has no audio tracks to preview. Upload audio files to enable quick-play.',
        },
        { status: 422 }
      )
    }

    // Generate synchronously (client shows loading spinner during this wait).
    await recomputePreviewMix(projectId)

    // Fetch the freshly written storage path.
    const { data: updated } = await supabase
      .from('projects')
      .select('preview_mix_storage_path')
      .eq('id', projectId)
      .single()

    if (!updated?.preview_mix_storage_path) {
      return NextResponse.json({ error: 'Preview generation failed' }, { status: 500 })
    }

    const url = await getPresignedDownloadUrl(updated.preview_mix_storage_path)
    return NextResponse.redirect(url, { status: 302 })
  }

  // ── Cached file exists — serve it immediately then maybe recompute ─────────

  if (!project.preview_mix_storage_path) {
    // Status is non-'none' but storage_path is missing — data inconsistency,
    // reset and let the next request regenerate.
    await supabase
      .from('projects')
      .update({ preview_mix_status: 'none' })
      .eq('id', projectId)
    return NextResponse.json({ error: 'Preview unavailable, please retry' }, { status: 503 })
  }

  // Determine if a background recompute should be triggered.
  const isStuck =
    project.preview_mix_status === 'computing' &&
    project.preview_mix_computing_started_at != null &&
    Date.now() - new Date(project.preview_mix_computing_started_at).getTime() > PREVIEW_STUCK_LOCK_MS

  const shouldCheckDebounce = project.preview_mix_status === 'stale' || isStuck

  if (shouldCheckDebounce && project.main_version_modified_at) {
    const secondsSinceChange =
      (Date.now() - new Date(project.main_version_modified_at).getTime()) / 1000

    if (secondsSinceChange >= PREVIEW_DEBOUNCE_SECONDS) {
      // Atomically claim the recompute slot.
      // For the stuck case we match on 'computing'; for stale we match on 'stale'.
      const matchStatus = isStuck ? 'computing' : 'stale'
      const { data: claimed } = await supabase
        .from('projects')
        .update({
          preview_mix_status: 'computing',
          preview_mix_computing_started_at: new Date().toISOString(),
        })
        .eq('id', projectId)
        .eq('preview_mix_status', matchStatus)
        .select('id')
        .maybeSingle()

      if (claimed) {
        // Fire background recompute after this response is sent.
        after(async () => {
          await recomputePreviewMix(projectId).catch(async (err) => {
            console.error('[preview-mix] background recompute failed:', err)
            // Reset to stale so the next request can retry.
            await supabase
              .from('projects')
              .update({ preview_mix_status: 'stale', preview_mix_computing_started_at: null })
              .eq('id', projectId)
              .catch(() => {})
          })
        })
      }
    }
  }

  // Return presigned redirect to cached MP3 — instant, no blocking.
  const url = await getPresignedDownloadUrl(project.preview_mix_storage_path)
  return NextResponse.redirect(url, { status: 302 })
}

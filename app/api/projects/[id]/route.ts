import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { logActivity } from '@/lib/activity'
import { requireBandMember } from '@/lib/supabase/server'

// PATCH /api/projects/[id] — update project metadata (name, bpm, key)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const body = await req.json()
    const { name, bpm, key } = body as { name?: string; bpm?: number | null; key?: string | null }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
      }
      if (name.trim().length > 80) {
        return NextResponse.json({ error: 'name must be 80 characters or fewer' }, { status: 400 })
      }
      updates.name = name.trim()
    }
    if (bpm !== undefined) {
      if (bpm == null || String(bpm).trim() === '') {
        updates.bpm = null
      } else {
        const n = typeof bpm === 'number' ? bpm : parseInt(String(bpm), 10)
        if (!Number.isFinite(n) || n < 40 || n > 300) {
          return NextResponse.json({ error: 'bpm must be between 40 and 300' }, { status: 400 })
        }
        updates.bpm = Math.round(n)
      }
    }
    if (key !== undefined) {
      if (key === null || key === '') {
        updates.key = null
      } else if (typeof key !== 'string') {
        return NextResponse.json({ error: 'key must be a string' }, { status: 400 })
      } else if (key.trim().length > 40) {
        return NextResponse.json({ error: 'key must be 40 characters or fewer' }, { status: 400 })
      } else {
        updates.key = key.trim()
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Fetch current values for change detection (bpm/key diffing)
    const { data: existing } = await supabase
      .from('projects')
      .select('bpm, key')
      .eq('id', projectId)
      .single()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .select('*, bands(name)')
      .single()
    if (error) throw error

    if (updates.bpm !== undefined && updates.bpm !== existing.bpm) {
      void logActivity({
        bandId: project.band_id,
        userId,
        action: 'meta',
        subject: 'BPM',
        detail: updates.bpm != null ? String(updates.bpm) : 'cleared',
        projectId,
      })
    }
    if (updates.key !== undefined && updates.key !== existing.key) {
      void logActivity({
        bandId: project.band_id,
        userId,
        action: 'meta',
        subject: 'Key',
        detail: updates.key != null ? String(updates.key) : 'cleared',
        projectId,
      })
    }

    if (data.bands) {
      data.band_name = (data.bands as { name: string }).name
      delete data.bands
    }

    return NextResponse.json({ project: data })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/projects/[id]
// Returns project + all versions + tracks (with comments) per version
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Enforce band membership before returning any data
    const access = await requireBandMember(req, id)
    if ('error' in access) {
      // Distinguish "project doesn't exist" from "no access" so the client
      // can show the right error screen without leaking existence information.
      // We return 403 for access-denied so the UI knows to show "no access"
      // rather than "not found" when the project does exist.
      if (access.status === 404) {
        // Could be truly missing or could be a non-member — check existence
        const { data: exists } = await supabase
          .from('projects')
          .select('id')
          .eq('id', id)
          .single()
        if (exists) {
          return NextResponse.json({ error: 'Access denied', code: 'ACCESS_DENIED' }, { status: 403 })
        }
      }
      return NextResponse.json({ error: access.error, code: 'NOT_FOUND' }, { status: access.status })
    }

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*, bands(name)')
      .eq('id', id)
      .single()
    if (projErr) return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })

    // Flatten band name into project object
    if (project.bands) {
      project.band_name = (project.bands as { name: string }).name
      delete project.bands
    }

    const { data: versions, error: verErr } = await supabase
      .from('versions')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
    if (verErr) throw verErr

    const versionIds = (versions ?? []).map((v: { id: string }) => v.id)

    const { data: tracks, error: trkErr } = await supabase
      .from('tracks')
      .select('*')
      .in('version_id', versionIds)
      .order('position', { ascending: true })
    if (trkErr) throw trkErr

    const trackIds = (tracks ?? []).map((t: { id: string }) => t.id)

    // Load comments with author usernames
    const { data: rawComments } = trackIds.length
      ? await supabase
          .from('track_comments')
          .select('*')
          .in('track_id', trackIds)
          .order('timecode_start_ms', { ascending: true })
      : { data: [] }

    // Fetch profiles for comment authors
    const authorIds = [...new Set((rawComments ?? []).map((c: { created_by: string }) => c.created_by).filter(Boolean))]
    const { data: authorProfiles } = authorIds.length
      ? await supabase.from('profiles').select('id, username').in('id', authorIds)
      : { data: [] }
    const authorMap = new Map((authorProfiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))

    // Load replies for all comments
    const commentIds = (rawComments ?? []).map((c: { id: string }) => c.id)
    const { data: rawReplies } = commentIds.length
      ? await supabase
          .from('comment_replies')
          .select('*')
          .in('comment_id', commentIds)
          .order('created_at', { ascending: true })
      : { data: [] }

    const replyAuthorIds = [...new Set((rawReplies ?? []).map((r: { created_by: string }) => r.created_by).filter(Boolean))]
    const { data: replyAuthorProfiles } = replyAuthorIds.length
      ? await supabase.from('profiles').select('id, username').in('id', replyAuthorIds)
      : { data: [] }
    const replyAuthorMap = new Map((replyAuthorProfiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))

    const repliesByCommentId = new Map<string, unknown[]>()
    for (const r of (rawReplies ?? [])) {
      const arr = repliesByCommentId.get(r.comment_id) ?? []
      arr.push({ ...r, author_username: replyAuthorMap.get(r.created_by) ?? 'unknown' })
      repliesByCommentId.set(r.comment_id, arr)
    }

    const comments = (rawComments ?? []).map((c: Record<string, unknown>) => ({
      ...c,
      author_username: authorMap.get(c.created_by as string) ?? 'unknown',
      replies: repliesByCommentId.get(c.id as string) ?? [],
    }))

    const tracksWithComments = (tracks ?? []).map((t: Record<string, unknown>) => ({
      ...t,
      comments: (comments ?? []).filter(
        (c: Record<string, unknown>) => c.track_id === t.id
      ),
    }))

    const versionsWithTracks = (versions ?? []).map((v: Record<string, unknown>) => ({
      ...v,
      tracks: tracksWithComments.filter(
        (t: Record<string, unknown>) => t.version_id === v.id
      ),
    }))

    return NextResponse.json({ project, versions: versionsWithTracks })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/[id] — owner deletes project, cleans up R2
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project, role } = access

    if (role !== 'owner') {
      return NextResponse.json({ error: 'Only band owners can delete projects' }, { status: 403 })
    }

    // Get all version IDs
    const { data: versions } = await supabase
      .from('versions')
      .select('id')
      .eq('project_id', projectId)
    const versionIds = (versions ?? []).map((v: { id: string }) => v.id)

    if (versionIds.length > 0) {
      // Get unique file paths in this project
      const { data: tracks } = await supabase
        .from('tracks')
        .select('file_hash, storage_path')
        .in('version_id', versionIds)

      // For each unique file_hash, check if used by other projects
      const seenHashes = new Set<string>()
      for (const t of tracks ?? []) {
        if (!t.file_hash || seenHashes.has(t.file_hash)) continue
        seenHashes.add(t.file_hash)

        // Check if this file_hash is used by tracks in other projects
        const { count } = await supabase
          .from('tracks')
          .select('id', { count: 'exact', head: true })
          .eq('file_hash', t.file_hash)
          .not('version_id', 'in', `(${versionIds.join(',')})`)

        if ((count ?? 0) === 0 && t.storage_path) {
          // Safe to delete from R2
          try {
            const { deleteFromR2 } = await import('@/lib/r2')
            await deleteFromR2(t.storage_path)
          } catch (e) {
            console.error('R2 delete failed for', t.storage_path, e)
            // Don't abort — continue with DB deletion
          }
        }
      }
    }

    // Delete project (cascades to versions, tracks, comments via FK)
    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
const adminSupabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

// GET /api/projects/[id]
// Returns project + all versions + tracks (with comments) per version
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('*, bands(name)')
      .eq('id', id)
      .single()
    if (projErr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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
      ? await adminSupabase
          .from('track_comments')
          .select('*')
          .in('track_id', trackIds)
          .order('timecode_start_ms', { ascending: true })
      : { data: [] }

    // Fetch profiles for comment authors
    const authorIds = [...new Set((rawComments ?? []).map((c: { created_by: string }) => c.created_by).filter(Boolean))]
    const { data: authorProfiles } = authorIds.length
      ? await adminSupabase.from('profiles').select('id, username').in('id', authorIds)
      : { data: [] }
    const authorMap = new Map((authorProfiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))

    // Load replies for all comments
    const commentIds = (rawComments ?? []).map((c: { id: string }) => c.id)
    const { data: rawReplies } = commentIds.length
      ? await adminSupabase
          .from('comment_replies')
          .select('*')
          .in('comment_id', commentIds)
          .order('created_at', { ascending: true })
      : { data: [] }

    const replyAuthorIds = [...new Set((rawReplies ?? []).map((r: { created_by: string }) => r.created_by).filter(Boolean))]
    const { data: replyAuthorProfiles } = replyAuthorIds.length
      ? await adminSupabase.from('profiles').select('id, username').in('id', replyAuthorIds)
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
    const token = req.cookies.get('sb-at')?.value
    const userId = token ? getUserIdFromToken(token) : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: projectId } = await params

    // Get band_id for this project
    const { data: project } = await supabase
      .from('projects')
      .select('band_id, name')
      .eq('id', projectId)
      .single()
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Verify requester is band owner
    const { data: membership } = await supabase
      .from('band_members')
      .select('role')
      .eq('band_id', project.band_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (membership.role !== 'owner') {
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

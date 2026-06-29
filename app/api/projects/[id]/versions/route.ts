import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

// POST /api/projects/[id]/versions
// Creates a new branch from an existing version.
// Body: { name: string, parent_id: string }
// Copies all tracks, sections, track_comments, and comment_replies
// from parent_id into the new version (pointer copy — no file duplication).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const { name, parent_id, tag } = await req.json()

    if (!name || !parent_id) {
      return NextResponse.json(
        { error: 'name and parent_id are required' },
        { status: 400 }
      )
    }

    // "Master" is reserved for the primary version
    if (name.trim().toLowerCase() === 'master') {
      return NextResponse.json(
        { error: '"Master" is reserved for the primary version. Try "Master 2" or another name.' },
        { status: 400 }
      )
    }

    // Validate tag length if provided
    if (tag != null && (typeof tag !== 'string' || tag.length > 20)) {
      return NextResponse.json({ error: 'tag must be a string of max 20 characters' }, { status: 400 })
    }

    // Verify parent belongs to this project
    const { data: parent, error: parentErr } = await supabase
      .from('versions')
      .select('id, project_id')
      .eq('id', parent_id)
      .single()
    if (parentErr || parent.project_id !== projectId) {
      return NextResponse.json({ error: 'parent_id not found' }, { status: 404 })
    }

    // Create branch version
    const { data: version, error: verErr } = await supabase
      .from('versions')
      .insert({ project_id: projectId, parent_id, name, type: 'branch', tag: tag ?? null })
      .select()
      .single()
    if (verErr) throw verErr

    const newVersionId = version.id

    // ── Copy tracks (pointer copy — same file_hash/storage_path) ─────────────
    const { data: parentTracks, error: trkErr } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', parent_id)
      .order('position', { ascending: true })
    if (trkErr) throw trkErr

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newTracks: any[] = []
    if (parentTracks && parentTracks.length > 0) {
      const copies = parentTracks.map(({ id: _id, created_at: _ca, ...t }: { id: string; created_at: string; [k: string]: unknown }) => ({
        ...t,
        version_id: newVersionId,
      }))
      const { data: inserted, error: insertErr } = await supabase
        .from('tracks')
        .insert(copies)
        .select('id, name')
      if (insertErr) throw insertErr
      if (inserted) newTracks.push(...inserted)
    }

    // Build old-track-name → new-track-id mapping for comment copying
    const newTrackByName = new Map(newTracks.map((t: { id: string; name: string }) => [t.name, t.id]))

    // ── Copy sections ─────────────────────────────────────────────────────────
    const { data: parentSections, error: secErr } = await supabase
      .from('sections')
      .select('*')
      .eq('version_id', parent_id)
    if (secErr) throw secErr

    if (parentSections && parentSections.length > 0) {
      const sectionCopies = parentSections.map(({ id: _id, created_at: _ca, ...s }: { id: string; created_at: string; [k: string]: unknown }) => ({
        ...s,
        version_id: newVersionId,
      }))
      const { error: secInsertErr } = await supabase.from('sections').insert(sectionCopies)
      if (secInsertErr) throw secInsertErr
    }

    // ── Copy track_comments ───────────────────────────────────────────────────
    const parentTrackIds = (parentTracks ?? []).map((t: { id: string }) => t.id)

    if (parentTrackIds.length > 0) {
      const { data: parentComments, error: cmtErr } = await supabase
        .from('track_comments')
        .select('*')
        .in('track_id', parentTrackIds)
      if (cmtErr) throw cmtErr

      if (parentComments && parentComments.length > 0) {
        // Build old-comment-id → parent-track-name mapping (to resolve new track id)
        const parentTrackById = new Map((parentTracks ?? []).map((t: { id: string; name: string }) => [t.id, t.name]))

        const commentCopies = parentComments.map(({ id: _id, ...c }: { id: string; [k: string]: unknown }) => {
          const trackName = parentTrackById.get(c.track_id as string)
          const newTrackId = trackName ? newTrackByName.get(trackName) : undefined
          if (!newTrackId) return null
          return { ...c, track_id: newTrackId, version_id: newVersionId }
        }).filter((r): r is NonNullable<typeof r> => r !== null)

        if (commentCopies.length > 0) {
          const { data: insertedComments, error: cmtInsertErr } = await supabase
            .from('track_comments')
            .insert(commentCopies)
            .select('id')
          if (cmtInsertErr) throw cmtInsertErr

          // ── Copy comment_replies ─────────────────────────────────────────
          // Map old comment ids to new comment ids
          const oldToNewCommentId = new Map<string, string>()
          if (insertedComments) {
            parentComments.forEach((oldCmt: { id: string }, i: number) => {
              if (insertedComments[i]) {
                oldToNewCommentId.set(oldCmt.id, insertedComments[i].id)
              }
            })
          }

          if (oldToNewCommentId.size > 0) {
            const { data: parentReplies, error: replyErr } = await supabase
              .from('comment_replies')
              .select('*')
              .in('comment_id', [...oldToNewCommentId.keys()])
            if (replyErr) throw replyErr

            if (parentReplies && parentReplies.length > 0) {
              const replyCopies = parentReplies.map(({ id: _id, ...r }: { id: string; [k: string]: unknown }) => {
                const newCommentId = oldToNewCommentId.get(r.comment_id as string)
                if (!newCommentId) return null
                return { ...r, comment_id: newCommentId }
              }).filter((r): r is NonNullable<typeof r> => r !== null)

              if (replyCopies.length > 0) {
                const { error: replyInsertErr } = await supabase.from('comment_replies').insert(replyCopies)
                if (replyInsertErr) throw replyInsertErr
              }
            }
          }
        }
      }
    }

    // Log activity (fire-and-forget)
    void logActivity({ bandId: project.band_id, userId, action: 'branch', subject: name, projectId })

    return NextResponse.json({ version }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

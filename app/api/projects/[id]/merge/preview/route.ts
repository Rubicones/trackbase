import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import {
  buildBarMap,
  diffBarMaps,
  calculateTotalBars,
  AutoBarRange,
} from '@/lib/sectionMerge'
import { trackStartBar } from '@/lib/trackMerge'
import type {
  TrackSnapshot,
  AutoMergeItem,
  CommentPreview,
  MergePreview,
} from '@/lib/mergePreview'

// Re-exported so client code that historically imported types from this route
// keeps compiling.
export type {
  TrackSnapshot,
  ConflictTrack,
  AutoMergeItem,
  CommentPreview,
  CommentChanges,
  MergePreview,
} from '@/lib/mergePreview'

// POST /api/projects/[id]/merge/preview
// Body: { branch_id: string, target_version_id?: string }
//
// TWO-WAY compare: the version being applied (branch) is diffed directly
// against the target. No ancestors, no merge base — what you see is exactly
// the difference between the two versions you picked. Every difference is a
// cherry-pickable change; there are no conflicts (`conflicts` and
// `sectionBarConflicts` are always empty and kept only for compatibility).
//
// Guardrail: each change carries `targetNewer` — true when the target's copy
// of that content is more recent than the version's, i.e. applying would
// overwrite newer work with older material.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { branch_id, target_version_id } = await req.json()

    if (!branch_id) {
      return NextResponse.json({ error: 'branch_id is required' }, { status: 400 })
    }

    // Fetch branch (the version being applied)
    const { data: branch, error: branchErr } = await supabase
      .from('versions')
      .select('*')
      .eq('id', branch_id)
      .eq('project_id', projectId)
      .single()
    if (branchErr || !branch) {
      return NextResponse.json({ error: 'branch not found' }, { status: 404 })
    }
    if (branch.merged_at) {
      return NextResponse.json({ error: 'branch already merged' }, { status: 400 })
    }

    // Fetch target version (explicit or default to main)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let main: any
    if (target_version_id) {
      const { data: targetVersion, error: targetErr } = await supabase
        .from('versions')
        .select('*')
        .eq('id', target_version_id)
        .eq('project_id', projectId)
        .single()
      if (targetErr || !targetVersion) {
        return NextResponse.json({ error: 'target version not found' }, { status: 404 })
      }
      if (target_version_id === branch_id) {
        return NextResponse.json({ error: 'cannot merge a branch into itself' }, { status: 400 })
      }
      if (targetVersion.merged_at) {
        return NextResponse.json({ error: 'cannot merge into a closed (already merged) branch' }, { status: 400 })
      }
      main = targetVersion
    } else {
      const { data: mainVersion, error: mainErr } = await supabase
        .from('versions')
        .select('*')
        .eq('project_id', projectId)
        .eq('type', 'main')
        .single()
      if (mainErr || !mainVersion) throw mainErr ?? new Error('main not found')
      main = mainVersion
    }

    // ── Fetch both track sets ─────────────────────────────────────────────────
    const branchTracksRes = await supabase.from('tracks').select('*').eq('version_id', branch_id)
    const mainTracksRes   = await supabase.from('tracks').select('*').eq('version_id', main.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchTracks: any[] = branchTracksRes.data ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainTracks: any[]   = mainTracksRes.data ?? []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function toSnapshot(t: any): TrackSnapshot {
      return {
        id: t.id,
        name: t.name,
        display_name: t.display_name ?? null,
        original_filename: t.original_filename ?? null,
        file_size_bytes: t.file_size_bytes ?? null,
        created_at: t.created_at,
        start_bar: trackStartBar(t),
      }
    }

    // Guardrail (best effort): is the target's copy of this content more
    // recent than the version's? Row created_at is bumped by every
    // row-recreating operation — upload, replace, branch copy, merge — but
    // NOT by in-place PATCHes (rename, offset drag), so this can under-warn.
    // It never blocks anything; it only marks changes for extra attention.
    // TODO: add an updated_at column (+ trigger) to tracks/sections to make
    // this exact.
    function isTargetNewer(targetCreatedAt: string | null, branchCreatedAt: string | null): boolean {
      if (!targetCreatedAt || !branchCreatedAt) return false
      return new Date(targetCreatedAt).getTime() > new Date(branchCreatedAt).getTime()
    }

    // ── Track diff (two-way, by track name) ───────────────────────────────────
    const autoMerge: AutoMergeItem[] = []

    for (const bt of branchTracks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mt: any | undefined = mainTracks.find((t: { name: string }) => t.name === bt.name)

      if (!mt) {
        // Only in the version → plain addition
        autoMerge.push({ action: 'add_new', trackName: bt.name, track: bt })
        continue
      }

      const targetNewer = isTargetNewer(mt.created_at, bt.created_at)

      const fileDiffers   = mt.file_hash !== bt.file_hash
      const nameDiffers   = (mt.display_name ?? mt.name) !== (bt.display_name ?? bt.name)
      const offsetDiffers = trackStartBar(mt) !== trackStartBar(bt)

      if (fileDiffers) {
        autoMerge.push({
          action: 'take_from_branch',
          trackName: bt.name,
          track: bt,
          ...(targetNewer && { targetNewer }),
        })
      }
      if (nameDiffers) {
        autoMerge.push({
          action: 'apply_rename',
          trackName: bt.name,
          track: bt,
          newDisplayName: bt.display_name ?? bt.name,
          ...(targetNewer && { targetNewer }),
        })
      }
      if (offsetDiffers) {
        autoMerge.push({
          action: 'apply_offset',
          trackName: bt.name,
          track: bt,
          newStartBar: trackStartBar(bt),
          previousStartBar: trackStartBar(mt),
          ...(targetNewer && { targetNewer }),
        })
      }
    }

    // Only in the target → target wins by default; removal is a per-track opt-in
    const branchNames = new Set(branchTracks.map((t: { name: string }) => t.name))
    const targetOnlyTracks: TrackSnapshot[] = mainTracks
      .filter((t: { name: string }) => !branchNames.has(t.name))
      .map(toSnapshot)

    // ── Section diff (two-way, per bar) ───────────────────────────────────────
    const [branchSections, mainSections] = await Promise.all([
      supabase.from('sections').select('*').eq('version_id', branch_id).then(r => r.data ?? []),
      supabase.from('sections').select('*').eq('version_id', main.id).then(r => r.data ?? []),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalBars = calculateTotalBars(branchSections as any[], mainSections as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchMap = buildBarMap(branchSections as any[], totalBars)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainMap   = buildBarMap(mainSections   as any[], totalBars)

    const sectionAutoFromBranch: AutoBarRange[] = diffBarMaps(branchMap, mainMap, totalBars)

    // Guardrail per range: compare the most recent section row touching the
    // range on each side. A side with no rows there contributes its version's
    // created_at (rows are copied at version creation).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function newestRowMs(sections: any[], range: { startBar: number; endBar: number }, fallbackIso: string | null): number {
      let max = fallbackIso ? new Date(fallbackIso).getTime() : 0
      for (const s of sections) {
        if (s.start_bar < range.endBar && s.end_bar > range.startBar && s.created_at) {
          max = Math.max(max, new Date(s.created_at).getTime())
        }
      }
      return max
    }
    for (const r of sectionAutoFromBranch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targetMs = newestRowMs(mainSections as any[], r, null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const branchMs = newestRowMs(branchSections as any[], r, branch.created_at)
      if (targetMs > 0 && targetMs > branchMs) r.targetNewer = true
    }

    // ── Comment diff (already two-way: content fingerprint) ───────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchTrackMap = new Map(branchTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainTrackMap   = new Map(mainTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    const branchCommentTrackIds = branchTracks.map((t: { id: string }) => t.id)
    const mainCommentTrackIds   = mainTracks.map((t: { id: string }) => t.id)

    const [rawBranchComments, rawMainComments] = await Promise.all([
      branchCommentTrackIds.length
        ? supabase.from('track_comments')
            .select('id, created_by, timecode_start_ms, timecode_end_ms, content, track_id')
            .in('track_id', branchCommentTrackIds)
            .then(r => r.data ?? [])
        : Promise.resolve([]),
      mainCommentTrackIds.length
        ? supabase.from('track_comments')
            .select('id, created_by, timecode_start_ms, timecode_end_ms, content, track_id')
            .in('track_id', mainCommentTrackIds)
            .then(r => r.data ?? [])
        : Promise.resolve([]),
    ])

    // Resolve author usernames from profiles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allAuthorIds = [...new Set([...(rawBranchComments as any[]), ...(rawMainComments as any[])].map((c: any) => c.created_by).filter(Boolean))]
    const { data: commentAuthorProfiles } = allAuthorIds.length
      ? await supabase.from('profiles').select('id, username').in('id', allAuthorIds)
      : { data: [] }
    const commentAuthorMap = new Map((commentAuthorProfiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))

    // Reply counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPreviewIds = [...(rawBranchComments as any[]), ...(rawMainComments as any[])].map((c: any) => c.id)
    const replyCounts = new Map<string, number>()
    if (allPreviewIds.length) {
      const { data: replies } = await supabase
        .from('comment_replies')
        .select('comment_id')
        .in('comment_id', allPreviewIds)
      for (const r of (replies ?? [])) {
        replyCounts.set(r.comment_id, (replyCounts.get(r.comment_id) ?? 0) + 1)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function toCommentPreview(c: any, trackMap: Map<string, string>): CommentPreview {
      return {
        id: c.id,
        author_username: commentAuthorMap.get(c.created_by) ?? null,
        timecode_start_ms: c.timecode_start_ms,
        timecode_end_ms: c.timecode_end_ms,
        content: c.content,
        track_name: trackMap.get(c.track_id) ?? 'Unknown track',
        reply_count: replyCounts.get(c.id) ?? 0,
      }
    }

    // Comments are copied with new UUIDs when a branch is created, so ID-based
    // diffing would falsely flag ALL comments as added/deleted. Instead we use
    // a content fingerprint: same (content, timecode_start, timecode_end, created_by)
    // = same logical comment. Only truly new or deleted comments surface here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function commentKey(c: any): string {
      return `${c.created_by}|${c.timecode_start_ms}|${c.timecode_end_ms}|${c.content}`
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainKeys = new Set((rawMainComments as any[]).map(commentKey))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchKeys = new Set((rawBranchComments as any[]).map(commentKey))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addedInBranch: CommentPreview[] = (rawBranchComments as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((bc: any) => !mainKeys.has(commentKey(bc)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((bc: any) => toCommentPreview(bc, branchTrackMap))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deletedInBranch: CommentPreview[] = (rawMainComments as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((mc: any) => !branchKeys.has(commentKey(mc)))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((mc: any) => toCommentPreview(mc, mainTrackMap))

    const result: MergePreview = {
      conflicts: [],               // two-way compare — no conflicts, ever
      autoMerge,
      branchName: branch.name,
      mainName: main.name,
      branchVersionId: branch_id,
      mainVersionId: main.id,
      targetVersionId: main.id,
      targetVersionName: main.name,
      branchCommentCount: addedInBranch.length,
      sectionBarConflicts: [],     // two-way compare — no conflicts, ever
      sectionAutoFromBranch,
      commentChanges: { added: addedInBranch, deleted: deletedInBranch },
      targetOnlyTracks,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

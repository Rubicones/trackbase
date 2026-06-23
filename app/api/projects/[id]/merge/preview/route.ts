import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import {
  buildBarMap,
  groupConsecutiveBars,
  calculateTotalBars,
  ConflictRange,
  AutoBarRange,
} from '@/lib/sectionMerge'
import { trackStartBar } from '@/lib/trackMerge'
import { buildVersionParentMap, findMergeBaseVersionId } from '@/lib/mergeBase'

// ─── Shared types (re-exported so MergeModal can import them) ─────────────────

interface TrackSnapshot {
  id: string
  name: string
  display_name: string | null
  original_filename: string | null
  file_size_bytes: number | null
  created_at: string
  start_bar: number
}

export interface ConflictTrack {
  trackName: string
  fileConflict: boolean
  renameConflict: boolean
  offsetConflict: boolean
  mainTrack: TrackSnapshot
  branchTrack: TrackSnapshot
  baseTrack: TrackSnapshot | null
}

export interface AutoMergeItem {
  action: 'take_from_branch' | 'add_new' | 'apply_rename' | 'apply_offset'
  trackName: string
  track: { id: string; name: string; display_name: string | null; original_filename: string | null; start_bar?: number }
  newDisplayName?: string
  newStartBar?: number
  previousStartBar?: number
}

export interface CommentPreview {
  id: string
  author_username: string | null
  timecode_start_ms: number
  timecode_end_ms: number
  content: string
  track_name: string
  reply_count: number
}

export interface CommentChanges {
  added: CommentPreview[]
  deleted: CommentPreview[]
}

export interface MergePreview {
  conflicts: ConflictTrack[]
  autoMerge: AutoMergeItem[]
  branchName: string
  mainName: string
  branchVersionId: string
  mainVersionId: string
  branchCommentCount: number
  targetVersionId: string
  targetVersionName: string
  // ── Section bar merge ──────────────────────────────────────────────────────
  sectionBarConflicts:   ConflictRange[]
  sectionAutoFromBranch: AutoBarRange[]
  // ── Comment diff ──────────────────────────────────────────────────────────
  commentChanges: CommentChanges
}

// POST /api/projects/[id]/merge/preview
// Body: { branch_id: string, target_version_id?: string }
// Returns conflict detection results without applying any changes.
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

    // Fetch branch
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

    const { data: projectVersions, error: versionsErr } = await supabase
      .from('versions')
      .select('id, parent_id')
      .eq('project_id', projectId)
    if (versionsErr) throw versionsErr

    const baseVersionId = findMergeBaseVersionId(
      branch,
      main.id,
      buildVersionParentMap(projectVersions ?? []),
    )
    if (!baseVersionId) {
      return NextResponse.json(
        { error: 'branch and merge target share no common ancestor' },
        { status: 400 },
      )
    }

    // Fetch all three track sets (base = LCA of branch and target, not parent_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseTracks: any[] = baseVersionId
      ? (await supabase.from('tracks').select('*').eq('version_id', baseVersionId)).data ?? []
      : []

    const branchTracksRes = await supabase.from('tracks').select('*').eq('version_id', branch_id)
    const mainTracksRes   = await supabase.from('tracks').select('*').eq('version_id', main.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchTracks: any[] = branchTracksRes.data ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainTracks: any[]   = mainTracksRes.data ?? []

    const conflicts: ConflictTrack[] = []
    const autoMerge: AutoMergeItem[] = []

    // Walk each track in branch
    for (const bt of branchTracks) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseTrack: any | undefined = baseTracks.find((t: { name: string }) => t.name === bt.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainTrack: any | undefined = mainTracks.find((t: { name: string }) => t.name === bt.name)

      // ── File change detection ──────────────────────────────────────────────
      const fileChangedInBranch = !baseTrack || baseTrack.file_hash !== bt.file_hash
      const fileChangedInMain   = baseTrack
        ? baseTrack.file_hash !== (mainTrack?.file_hash ?? baseTrack.file_hash)
        : false
      const fileConflict = fileChangedInBranch && fileChangedInMain && !!mainTrack

      // ── Rename detection ───────────────────────────────────────────────────
      const baseDisplay   = baseTrack   ? (baseTrack.display_name   ?? baseTrack.name)   : null
      const branchDisplay = bt.display_name ?? bt.name
      const mainDisplay   = mainTrack   ? (mainTrack.display_name   ?? mainTrack.name)   : null

      const renamedInBranch = baseTrack ? branchDisplay !== baseDisplay : false
      const renamedInMain   = baseTrack && mainTrack ? mainDisplay !== baseDisplay : false
      const renameConflict  = renamedInBranch && renamedInMain && branchDisplay !== mainDisplay

      // ── Start bar (track offset) detection ─────────────────────────────────
      const baseStartBar = trackStartBar(baseTrack)
      const branchStartBar = trackStartBar(bt)
      const mainStartBar = mainTrack ? trackStartBar(mainTrack) : baseStartBar
      const offsetChangedInBranch = !baseTrack || branchStartBar !== baseStartBar
      const offsetChangedInMain = baseTrack && mainTrack ? mainStartBar !== baseStartBar : false
      const offsetConflict = offsetChangedInBranch && offsetChangedInMain && branchStartBar !== mainStartBar

      function toSnapshot(t: typeof bt): TrackSnapshot {
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

      // ── Categorise ────────────────────────────────────────────────────────
      if (fileConflict || renameConflict || offsetConflict) {
        conflicts.push({
          trackName:    bt.name,
          fileConflict,
          renameConflict,
          offsetConflict,
          mainTrack:   toSnapshot(mainTrack ?? bt),
          branchTrack: toSnapshot(bt),
          baseTrack:   baseTrack ? toSnapshot(baseTrack) : null,
        })
      } else {
        if (fileChangedInBranch) {
          const action = !baseTrack && !mainTrack ? 'add_new' : 'take_from_branch'
          autoMerge.push({ action, trackName: bt.name, track: bt })
        }
        // Auto-rename: branch renamed, main didn't (or no base)
        if (renamedInBranch && !renameConflict) {
          autoMerge.push({
            action: 'apply_rename',
            trackName: bt.name,
            track: bt,
            newDisplayName: branchDisplay,
          })
        }
        // Auto-offset: branch moved track, main didn't
        if (offsetChangedInBranch && !offsetConflict) {
          autoMerge.push({
            action: 'apply_offset',
            trackName: bt.name,
            track: bt,
            newStartBar: branchStartBar,
            previousStartBar: baseStartBar,
          })
        }
      }
    }

    // ── Section bar conflict detection ────────────────────────────────────────
    const [baseSections, branchSections, mainSections] = await Promise.all([
      baseVersionId
        ? supabase.from('sections').select('*').eq('version_id', baseVersionId).then(r => r.data ?? [])
        : Promise.resolve([]),
      supabase.from('sections').select('*').eq('version_id', branch_id).then(r => r.data ?? []),
      supabase.from('sections').select('*').eq('version_id', main.id).then(r => r.data ?? []),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalBars = calculateTotalBars(baseSections as any[], branchSections as any[], mainSections as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseMap   = buildBarMap(baseSections   as any[], totalBars)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchMap = buildBarMap(branchSections as any[], totalBars)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainMap   = buildBarMap(mainSections   as any[], totalBars)

    const { conflicts: sectionBarConflicts, autoFromBranch: sectionAutoFromBranch } =
      groupConsecutiveBars(baseMap, branchMap, mainMap, totalBars)

    // ── Comment diff (added in branch / deleted in branch vs main) ───────────
    // We compare main's comments vs branch's comments so that a comment deleted
    // in the branch (but still present on main) correctly surfaces as "deleted".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchTrackMap = new Map(branchTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainTrackMap   = new Map(mainTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    const branchCommentTrackIds = branchTracks.map((t: { id: string }) => t.id)
    const mainCommentTrackIds   = mainTracks.map((t: { id: string }) => t.id)

    // Note: track_comments stores the author as `created_by` (user UUID),
    // not `author_username`. We fetch created_by and resolve usernames below.
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
      conflicts,
      autoMerge,
      branchName: branch.name,
      mainName: main.name,
      branchVersionId: branch_id,
      mainVersionId: main.id,
      targetVersionId: main.id,
      targetVersionName: main.name,
      branchCommentCount: addedInBranch.length,
      sectionBarConflicts,
      sectionAutoFromBranch,
      commentChanges: { added: addedInBranch, deleted: deletedInBranch },
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  buildBarMap,
  groupConsecutiveBars,
  calculateTotalBars,
  ConflictRange,
  AutoBarRange,
} from '@/lib/sectionMerge'

// ─── Shared types (re-exported so MergeModal can import them) ─────────────────

interface TrackSnapshot {
  id: string
  name: string
  display_name: string | null
  original_filename: string | null
  file_size_bytes: number | null
  created_at: string
  storage_path: string
}

export interface ConflictTrack {
  trackName: string
  fileConflict: boolean
  renameConflict: boolean
  mainTrack: TrackSnapshot
  branchTrack: TrackSnapshot
  baseTrack: TrackSnapshot | null
}

export interface AutoMergeItem {
  action: 'take_from_branch' | 'add_new' | 'apply_rename'
  trackName: string
  track: { id: string; name: string; display_name: string | null; original_filename: string | null }
  newDisplayName?: string
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
  // ── Section bar merge ──────────────────────────────────────────────────────
  sectionBarConflicts:   ConflictRange[]
  sectionAutoFromBranch: AutoBarRange[]
  // ── Comment diff ──────────────────────────────────────────────────────────
  commentChanges: CommentChanges
}

// POST /api/projects/[id]/merge/preview
// Body: { branch_id: string }
// Returns conflict detection results without applying any changes.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const { branch_id } = await req.json()

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

    // Fetch main
    const { data: main, error: mainErr } = await supabase
      .from('versions')
      .select('*')
      .eq('project_id', projectId)
      .eq('type', 'main')
      .single()
    if (mainErr || !main) throw mainErr ?? new Error('main not found')

    // Fetch all three track sets
    const baseVersionId = branch.parent_id
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

      // ── Categorise ────────────────────────────────────────────────────────
      if (fileConflict || renameConflict) {
        conflicts.push({
          trackName:    bt.name,
          fileConflict,
          renameConflict,
          mainTrack:   mainTrack,
          branchTrack: bt,
          baseTrack:   baseTrack ?? null,
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

    // ── Comment diff (added in branch / deleted in branch vs base) ────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchTrackMap = new Map(branchTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseTrackMap   = new Map(baseTracks.map((t: any) => [t.id, t.display_name ?? t.name]))
    const branchCommentTrackIds = branchTracks.map((t: { id: string }) => t.id)
    const baseCommentTrackIds   = baseTracks.map((t: { id: string }) => t.id)

    const [rawBranchComments, rawBaseComments] = await Promise.all([
      branchCommentTrackIds.length
        ? supabase.from('track_comments')
            .select('id, author_username, timecode_start_ms, timecode_end_ms, content, track_id')
            .in('track_id', branchCommentTrackIds)
            .then(r => r.data ?? [])
        : Promise.resolve([]),
      baseCommentTrackIds.length
        ? supabase.from('track_comments')
            .select('id, author_username, timecode_start_ms, timecode_end_ms, content, track_id')
            .in('track_id', baseCommentTrackIds)
            .then(r => r.data ?? [])
        : Promise.resolve([]),
    ])

    // Reply counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allPreviewIds = [...(rawBranchComments as any[]), ...(rawBaseComments as any[])].map((c: any) => c.id)
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
        author_username: c.author_username,
        timecode_start_ms: c.timecode_start_ms,
        timecode_end_ms: c.timecode_end_ms,
        content: c.content,
        track_name: trackMap.get(c.track_id) ?? 'Unknown track',
        reply_count: replyCounts.get(c.id) ?? 0,
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addedInBranch: CommentPreview[] = (rawBranchComments as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((bc: any) => !(rawBaseComments as any[]).some((base: any) => base.id === bc.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((bc: any) => toCommentPreview(bc, branchTrackMap))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deletedInBranch: CommentPreview[] = (rawBaseComments as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((base: any) => !(rawBranchComments as any[]).some((bc: any) => bc.id === base.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((base: any) => toCommentPreview(base, baseTrackMap))

    const result: MergePreview = {
      conflicts,
      autoMerge,
      branchName: branch.name,
      mainName: main.name,
      branchVersionId: branch_id,
      mainVersionId: main.id,
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

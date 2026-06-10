import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

export interface MergePreview {
  conflicts: ConflictTrack[]
  autoMerge: AutoMergeItem[]
  branchName: string
  mainName: string
  branchVersionId: string
  mainVersionId: string
  branchCommentCount: number
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

    // Count branch comments not in main
    const branchTrackIds2 = branchTracks.map((t: { id: string }) => t.id)
    const mainTrackIds2 = mainTracks.map((t: { id: string }) => t.id)
    const [branchCommentData, mainCommentData] = await Promise.all([
      branchTrackIds2.length
        ? supabase.from('track_comments').select('id').in('track_id', branchTrackIds2).then(r => r.data ?? [])
        : Promise.resolve([]),
      mainTrackIds2.length
        ? supabase.from('track_comments').select('id').in('track_id', mainTrackIds2).then(r => r.data ?? [])
        : Promise.resolve([]),
    ])
    const mainCommentIdSet2 = new Set((mainCommentData as { id: string }[]).map(c => c.id))
    const branchOnlyCommentCount = (branchCommentData as { id: string }[]).filter(c => !mainCommentIdSet2.has(c.id)).length

    const result: MergePreview = {
      conflicts,
      autoMerge,
      branchName: branch.name,
      mainName: main.name,
      branchVersionId: branch_id,
      mainVersionId: main.id,
      branchCommentCount: branchOnlyCommentCount,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

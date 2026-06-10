import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export interface ConflictTrack {
  trackName: string
  mainTrack: { id: string; name: string; original_filename: string | null; file_size_bytes: number | null; created_at: string; storage_path: string }
  branchTrack: { id: string; name: string; original_filename: string | null; file_size_bytes: number | null; created_at: string; storage_path: string }
}

export interface AutoMergeItem {
  action: 'take_from_branch' | 'add_new'
  trackName: string
  track: { id: string; name: string; original_filename: string | null }
}

export interface MergePreview {
  conflicts: ConflictTrack[]
  autoMerge: AutoMergeItem[]
  branchName: string
  mainName: string
  branchVersionId: string
  mainVersionId: string
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

    // Fetch base (snapshot at branch creation = branch.parent_id)
    const baseVersionId = branch.parent_id
    const baseTracks = baseVersionId
      ? (await supabase.from('tracks').select('*').eq('version_id', baseVersionId)).data ?? []
      : []

    const branchTracksRes = await supabase.from('tracks').select('*').eq('version_id', branch_id)
    const mainTracksRes   = await supabase.from('tracks').select('*').eq('version_id', main.id)
    const branchTracks = branchTracksRes.data ?? []
    const mainTracks   = mainTracksRes.data   ?? []

    const conflicts: ConflictTrack[] = []
    const autoMerge: AutoMergeItem[] = []

    // Walk each track in branch
    for (const bt of branchTracks) {
      const baseTrack = baseTracks.find((t: { name: string }) => t.name === bt.name)
      const mainTrack = mainTracks.find((t: { name: string }) => t.name === bt.name)

      const changedInBranch = !baseTrack || baseTrack.file_hash !== bt.file_hash
      const changedInMain   = !baseTrack
        ? false
        : baseTrack.file_hash !== (mainTrack?.file_hash ?? baseTrack.file_hash)

      if (changedInBranch && changedInMain && mainTrack) {
        conflicts.push({ trackName: bt.name, mainTrack, branchTrack: bt })
      } else if (changedInBranch && !changedInMain) {
        // New track (not in base or main) → add_new; changed only in branch → take_from_branch
        const action = !baseTrack && !mainTrack ? 'add_new' : 'take_from_branch'
        autoMerge.push({ action, trackName: bt.name, track: bt })
      }
      // changedInMain && !changedInBranch → main is already current, nothing to do
    }

    // Tracks added in branch that are completely new (not in base, not in main)
    // already handled above in the loop — but ensure we don't double-add
    const result: MergePreview = {
      conflicts,
      autoMerge,
      branchName: branch.name,
      mainName: main.name,
      branchVersionId: branch_id,
      mainVersionId: main.id,
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

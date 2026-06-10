import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/projects/[id]/merge
// Body: {
//   branchVersionId: string,
//   resolutions: Array<{ trackName: string, choice: 'main' | 'branch' }>
// }
//
// Algorithm:
//   1. Load current main tracks (these are the starting point)
//   2. Re-run conflict detection to get autoMerge list
//   3. Apply autoMerge: take_from_branch → replace/add; add_new → insert
//   4. Apply resolutions: 'branch' → replace with branch track; 'main' → keep existing
//   5. Mark branch as merged
//   6. Return updated main version with tracks
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const { branchVersionId, resolutions = [] } = await req.json() as {
      branchVersionId: string
      resolutions: Array<{ trackName: string; choice: 'main' | 'branch' }>
    }

    if (!branchVersionId) {
      return NextResponse.json({ error: 'branchVersionId is required' }, { status: 400 })
    }

    // Fetch branch
    const { data: branch, error: branchErr } = await supabase
      .from('versions')
      .select('*')
      .eq('id', branchVersionId)
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

    // Fetch all relevant track sets
    const baseVersionId = branch.parent_id
    const [baseTrk, branchTrk, mainTrk] = await Promise.all([
      baseVersionId
        ? supabase.from('tracks').select('*').eq('version_id', baseVersionId).then(r => r.data ?? [])
        : Promise.resolve([]),
      supabase.from('tracks').select('*').eq('version_id', branchVersionId).order('position', { ascending: true }).then(r => r.data ?? []),
      supabase.from('tracks').select('*').eq('version_id', main.id).order('position', { ascending: true }).then(r => r.data ?? []),
    ])

    // Build the merged track set starting from current main
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mergedMap = new Map<string, any>() // keyed by track name
    for (const t of mainTrk) mergedMap.set(t.name, t)

    // Apply autoMerge changes (tracks changed only in branch, or new to branch)
    for (const bt of branchTrk) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseTrack = (baseTrk as any[]).find((t: { name: string }) => t.name === bt.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainTrack = (mainTrk as any[]).find((t: { name: string }) => t.name === bt.name)

      const changedInBranch = !baseTrack || baseTrack.file_hash !== bt.file_hash
      const changedInMain   = baseTrack && baseTrack.file_hash !== (mainTrack?.file_hash ?? baseTrack.file_hash)

      if (changedInBranch && !changedInMain) {
        // Auto: take from branch (covers both take_from_branch and add_new)
        mergedMap.set(bt.name, bt)
      }
    }

    // Apply user resolutions (conflicts)
    const resolutionMap = new Map(resolutions.map(r => [r.trackName, r.choice]))
    for (const bt of branchTrk) {
      const choice = resolutionMap.get(bt.name)
      if (choice === 'branch') {
        mergedMap.set(bt.name, bt)
      }
      // choice === 'main' → mergedMap already has the main track, nothing to do
    }

    // Build final ordered track list (preserve positions, re-number if needed)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalTracks: any[] = Array.from(mergedMap.values())
    // Sort: preserve original position order from main, new tracks go at the end
    finalTracks.sort((a, b) => {
      const aIsFromMain = mainTrk.some((t: { id: string }) => t.id === a.id)
      const bIsFromMain = mainTrk.some((t: { id: string }) => t.id === b.id)
      if (aIsFromMain && bIsFromMain) return a.position - b.position
      if (aIsFromMain) return -1
      if (bIsFromMain) return 1
      return a.position - b.position
    })

    // Wipe main tracks and insert merged set
    const { error: delErr } = await supabase.from('tracks').delete().eq('version_id', main.id)
    if (delErr) throw delErr

    if (finalTracks.length > 0) {
      const copies = finalTracks.map(({ id: _id, created_at: _ca, version_id: _vi, ...rest }: {
        id: string; created_at: string; version_id: string; [k: string]: unknown
      }, i: number) => ({
        ...rest,
        version_id: main.id,
        position: i,
      }))
      const { error: insertErr } = await supabase.from('tracks').insert(copies)
      if (insertErr) throw insertErr
    }

    // Mark branch as merged
    const { error: mergeErr } = await supabase
      .from('versions')
      .update({ merged_at: new Date().toISOString() })
      .eq('id', branchVersionId)
    if (mergeErr) throw mergeErr

    // Return fresh main with tracks
    const { data: updatedTracks } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', main.id)
      .order('position', { ascending: true })

    return NextResponse.json({
      merged: true,
      main_id: main.id,
      tracks_updated: finalTracks.length,
      tracks: updatedTracks ?? [],
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

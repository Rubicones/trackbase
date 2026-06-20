import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { markPreviewMixStale } from '@/lib/previewMix'
import {
  buildBarMap,
  groupConsecutiveBars,
  barMapToSections,
  calculateTotalBars,
  BarState,
} from '@/lib/sectionMerge'
import { trackStartBar } from '@/lib/trackMerge'

// POST /api/projects/[id]/merge
// Body: {
//   branchVersionId: string,
//   resolutions: Array<{
//     trackName: string,
//     fileChoice?: 'main' | 'branch',   // required when fileConflict
//     nameChoice?: 'main' | 'branch',   // required when renameConflict
//     offsetChoice?: 'main' | 'branch', // required when offsetConflict
//   }>,
//   sectionResolutions: Array<{
//     startBar: number,
//     endBar: number,
//     choice: 'main' | 'branch',
//   }>
// }
//
// Algorithm:
//   1. Load base/branch/main track sets
//   2. Re-run conflict detection to determine fileConflict, renameConflict,
//      fileChangedInBranch, renamedInBranch flags per track
//   3. Determine final file source and display_name for each track
//   4. Wipe main tracks and insert the merged set
//   5. Build section finalMap from bar-by-bar merge + resolutions
//   6. Replace main sections with finalMap output
//   7. Mark branch as merged
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project: _project } = access
    const { branchVersionId, resolutions = [], sectionResolutions = [] } = await req.json() as {
      branchVersionId: string
      resolutions: Array<{ trackName: string; fileChoice?: 'main' | 'branch'; nameChoice?: 'main' | 'branch'; offsetChoice?: 'main' | 'branch' }>
      sectionResolutions: Array<{ startBar: number; endBar: number; choice: 'main' | 'branch' }>
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [baseTrk, branchTrk, mainTrk]: [any[], any[], any[]] = await Promise.all([
      baseVersionId
        ? supabase.from('tracks').select('*').eq('version_id', baseVersionId).then(r => r.data ?? [])
        : Promise.resolve([]),
      supabase.from('tracks').select('*').eq('version_id', branchVersionId).order('position', { ascending: true }).then(r => r.data ?? []),
      supabase.from('tracks').select('*').eq('version_id', main.id).order('position', { ascending: true }).then(r => r.data ?? []),
    ])

    // Start with all main tracks (tracks not touched by branch remain as-is)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mergedMap = new Map<string, any>()
    for (const t of mainTrk) mergedMap.set(t.name, t)

    const resolutionMap = new Map(resolutions.map(r => [r.trackName, r]))

    // Process each branch track
    for (const bt of branchTrk) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseTrack: any  = baseTrk.find((t: { name: string }) => t.name === bt.name) ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mainTrack: any  = mainTrk.find((t: { name: string }) => t.name === bt.name) ?? null

      // ── File conflict detection ────────────────────────────────────────────
      const fileChangedInBranch = !baseTrack || baseTrack.file_hash !== bt.file_hash
      const fileChangedInMain   = baseTrack
        ? baseTrack.file_hash !== (mainTrack?.file_hash ?? baseTrack.file_hash)
        : false
      const fileConflict = fileChangedInBranch && fileChangedInMain && !!mainTrack

      // ── Rename detection ───────────────────────────────────────────────────
      const baseDisplay   = baseTrack  ? (baseTrack.display_name  ?? baseTrack.name)  : null
      const branchDisplay = bt.display_name ?? bt.name
      const mainDisplay   = mainTrack  ? (mainTrack.display_name  ?? mainTrack.name)  : null

      const renamedInBranch = baseTrack ? branchDisplay !== baseDisplay : false
      const renamedInMain   = baseTrack && mainTrack ? mainDisplay !== baseDisplay : false
      const renameConflict  = renamedInBranch && renamedInMain && branchDisplay !== mainDisplay
      const autoRename      = renamedInBranch && !renameConflict

      const resolution = resolutionMap.get(bt.name)

      // ── Step 1: Choose file source ─────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fileSource: any
      if (fileConflict) {
        fileSource = resolution?.fileChoice === 'branch' ? bt : (mainTrack ?? bt)
      } else if (fileChangedInBranch) {
        fileSource = bt
      } else {
        fileSource = mainTrack ?? bt
      }

      // ── Step 2: Determine final display_name ──────────────────────────────
      let finalDisplayName: string | null
      if (renameConflict) {
        finalDisplayName = resolution?.nameChoice === 'branch'
          ? (bt.display_name ?? null)
          : (mainTrack?.display_name ?? null)
      } else if (autoRename) {
        finalDisplayName = bt.display_name ?? null
      } else {
        finalDisplayName = mainTrack?.display_name ?? null
      }

      const baseStartBar = trackStartBar(baseTrack)
      const branchStartBar = trackStartBar(bt)
      const mainStartBar = mainTrack ? trackStartBar(mainTrack) : baseStartBar
      const offsetChangedInBranch = !baseTrack || branchStartBar !== baseStartBar
      const offsetChangedInMain = baseTrack && mainTrack ? mainStartBar !== baseStartBar : false
      const offsetConflict = offsetChangedInBranch && offsetChangedInMain && branchStartBar !== mainStartBar

      let finalStartBar: number
      if (offsetConflict) {
        finalStartBar = resolution?.offsetChoice === 'branch' ? branchStartBar : mainStartBar
      } else if (offsetChangedInBranch) {
        finalStartBar = branchStartBar
      } else {
        finalStartBar = mainStartBar
      }

      mergedMap.set(bt.name, {
        ...fileSource,
        display_name: finalDisplayName,
        start_bar: finalStartBar,
        midi_start_bar: finalStartBar,
      })
    }

    // Build final ordered track list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalTracks: any[] = Array.from(mergedMap.values())
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

    // ── Section bar merge ─────────────────────────────────────────────────────
    const [baseSections, branchSections, mainSections] = await Promise.all([
      baseVersionId
        ? supabase.from('sections').select('*').eq('version_id', baseVersionId).then(r => r.data ?? [])
        : Promise.resolve([]),
      supabase.from('sections').select('*').eq('version_id', branchVersionId).then(r => r.data ?? []),
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

    const { conflicts: sectionConflicts, autoFromBranch } =
      groupConsecutiveBars(baseMap, branchMap, mainMap, totalBars)

    // Build final bar map: start from main, apply auto-from-branch, then resolutions
    const finalMap: (BarState | null)[] = [...mainMap]

    for (const range of autoFromBranch) {
      for (let b = range.startBar; b < range.endBar; b++) {
        finalMap[b] = branchMap[b]
      }
    }

    for (const res of sectionResolutions) {
      const conflict = sectionConflicts.find(
        c => c.startBar === res.startBar && c.endBar === res.endBar
      )
      if (!conflict) continue
      const chosenState = res.choice === 'branch' ? conflict.branchState : conflict.mainState
      for (let b = res.startBar; b < res.endBar; b++) {
        finalMap[b] = chosenState
      }
    }

    const newSections = barMapToSections(finalMap, main.id, projectId)

    const { error: delSecErr } = await supabase
      .from('sections')
      .delete()
      .eq('version_id', main.id)
    if (delSecErr) throw delSecErr

    if (newSections.length > 0) {
      const { error: insSecErr } = await supabase.from('sections').insert(newSections)
      if (insSecErr) throw insSecErr
    }

    // Mark branch as merged
    const { error: mergeErr } = await supabase
      .from('versions')
      .update({ merged_at: new Date().toISOString() })
      .eq('id', branchVersionId)
    if (mergeErr) throw mergeErr

    // ── Copy comments to new main snapshot ────────────────────────────────────
    const { data: newMainTracks } = await supabase
      .from('tracks')
      .select('id, name')
      .eq('version_id', main.id)

    const newTrackByName = new Map((newMainTracks ?? []).map((t: { id: string; name: string }) => [t.name, t.id]))

    const oldMainTrackIds = mainTrk.map((t: { id: string }) => t.id)
    const branchTrackIds  = branchTrk.map((t: { id: string }) => t.id)

    const [mainComments, branchComments] = await Promise.all([
      oldMainTrackIds.length
        ? supabase.from('track_comments').select('*').in('track_id', oldMainTrackIds).then(r => r.data ?? [])
        : Promise.resolve([]),
      branchTrackIds.length
        ? supabase.from('track_comments').select('*').in('track_id', branchTrackIds).then(r => r.data ?? [])
        : Promise.resolve([]),
    ])

    const oldToNewCommentId = new Map<string, string>()
    const allCommentsToCopy: Array<{ oldId: string; trackName: string; comment: Record<string, unknown> }> = []

    for (const c of mainComments) {
      const track = mainTrk.find((t: { id: string }) => t.id === c.track_id)
      if (!track) continue
      allCommentsToCopy.push({ oldId: c.id, trackName: track.name, comment: c })
    }

    // Only include branch comments that were added AFTER the branch was created.
    // Comments copied from the parent at branch-creation time have a created_at
    // that is ≤ branch.created_at — skip those to avoid duplicating main's
    // existing comments in the merged result.
    const branchCreatedAt = new Date(branch.created_at).getTime()
    const mainCommentIds  = new Set(mainComments.map((c: { id: string }) => c.id))
    for (const c of branchComments) {
      if (mainCommentIds.has(c.id)) continue
      if (new Date(c.created_at as string).getTime() <= branchCreatedAt) continue
      const track = branchTrk.find((t: { id: string }) => t.id === c.track_id)
      if (!track) continue
      allCommentsToCopy.push({ oldId: c.id, trackName: track.name, comment: c })
    }

    if (allCommentsToCopy.length > 0) {
      const newCommentRows = allCommentsToCopy.map(({ comment, trackName }) => {
        const newTrackId = newTrackByName.get(trackName)
        if (!newTrackId) return null
        const { id: _id, track_id: _ti, version_id: _vi, ...rest } = comment as { id: string; track_id: string; version_id: string; [k: string]: unknown }
        return { ...rest, track_id: newTrackId, version_id: main.id }
      }).filter((r): r is NonNullable<typeof r> => r !== null)

      if (newCommentRows.length > 0) {
        const { data: insertedComments } = await supabase
          .from('track_comments')
          .insert(newCommentRows)
          .select('id')

        if (insertedComments) {
          allCommentsToCopy.forEach(({ oldId }, i) => {
            if (insertedComments[i]) oldToNewCommentId.set(oldId, insertedComments[i].id)
          })
        }
      }
    }

    if (oldToNewCommentId.size > 0) {
      const { data: allReplies } = await supabase
        .from('comment_replies')
        .select('*')
        .in('comment_id', [...oldToNewCommentId.keys()])

      if (allReplies && allReplies.length > 0) {
        const replyRows = allReplies.map((r: { id: string; comment_id: string; [k: string]: unknown }) => {
          const newCommentId = oldToNewCommentId.get(r.comment_id)
          if (!newCommentId) return null
          const { id: _id, comment_id: _ci, ...rest } = r
          return { ...rest, comment_id: newCommentId }
        }).filter((r): r is NonNullable<typeof r> => r !== null)

        if (replyRows.length > 0) {
          await supabase.from('comment_replies').insert(replyRows)
        }
      }
    }

    const { data: updatedTracks } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', main.id)
      .order('position', { ascending: true })

    // Merging a branch into main changes the track set — mark preview stale.
    void markPreviewMixStale(projectId)

    // Log activity (fire-and-forget)
    supabase
      .from('projects').select('band_id, name').eq('id', projectId).maybeSingle()
      .then(({ data: proj }) => {
        if (proj) logActivity({
          bandId: proj.band_id, userId, action: 'merge',
          subject: `${branch.name} → main`, projectId,
        })
      })

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

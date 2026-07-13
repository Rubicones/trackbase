import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { markPreviewMixStale } from '@/lib/previewMix'
import {
  buildBarMap,
  diffBarMaps,
  barMapToSections,
  calculateTotalBars,
  BarState,
} from '@/lib/sectionMerge'
import { trackStartBar } from '@/lib/trackMerge'

// POST /api/projects/[id]/merge
//
// TWO-WAY apply: the version (branch) is diffed directly against the target —
// no ancestors, no merge base. The rules are:
//
//   Tracks (matched by name):
//     · in both, identical            → target row kept untouched
//     · in both, differing            → version's state applied (file, name,
//                                       start bar) unless the name is listed
//                                       in skippedTracks (then target wins)
//     · only in version               → added, unless in skippedTracks
//     · only in target                → KEPT (target wins for absences),
//                                       unless explicitly in removedTracks
//
//   Structure (per bar):
//     · bars where the version differs from the target take the version's
//       state, except bars covered by skippedSections (bar-coverage: a stale
//       range from an outdated preview still protects exactly those bars)
//
//   Comments: content-fingerprint diff (same as preview), with per-comment
//   cherry-picks and an optional bulk deletion choice.
//
// The same diff primitives (diffBarMaps, name matching, fingerprints) drive
// both this route and the preview route, so what the user reviewed is what
// gets applied.
//
// Body: {
//   branchVersionId: string,
//   target_version_id?: string,                       // defaults to main
//   skippedTracks?: string[],                         // version changes to leave out
//   removedTracks?: string[],                         // target-only tracks to delete (opt-in)
//   skippedSections?: Array<{ startBar, endBar }>,    // bars that keep the target's structure
//   skippedAddedCommentIds?: string[],
//   appliedDeletedCommentIds?: string[],
//   commentDeletionChoice?: 'keep' | 'apply',
// }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project: _project } = access

    const body = await req.json() as {
      branchVersionId?: unknown
      target_version_id?: unknown
      skippedTracks?: unknown
      removedTracks?: unknown
      skippedSections?: unknown
      skippedAddedCommentIds?: unknown
      appliedDeletedCommentIds?: unknown
      commentDeletionChoice?: unknown
    }

    // ── Input sanitisation — reject nothing silently mutable, coerce hard ────
    const branchVersionId = typeof body.branchVersionId === 'string' ? body.branchVersionId : ''
    const target_version_id = typeof body.target_version_id === 'string' ? body.target_version_id : undefined

    const strArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

    const skippedTrackSet         = new Set(strArray(body.skippedTracks))
    const removedTrackSet         = new Set(strArray(body.removedTracks))
    const skippedAddedCommentSet  = new Set(strArray(body.skippedAddedCommentIds))
    const appliedDeletedCommentSet = new Set(strArray(body.appliedDeletedCommentIds))
    const commentDeletionChoice   = body.commentDeletionChoice === 'apply' ? 'apply' : 'keep'

    const skippedSections: Array<{ startBar: number; endBar: number }> =
      (Array.isArray(body.skippedSections) ? body.skippedSections : [])
        .filter((s): s is { startBar: number; endBar: number } =>
          !!s && typeof s === 'object'
          && Number.isFinite((s as { startBar?: unknown }).startBar)
          && Number.isFinite((s as { endBar?: unknown }).endBar))
        .map(s => ({ startBar: Math.floor(s.startBar), endBar: Math.floor(s.endBar) }))
        .filter(s => s.endBar > s.startBar && s.startBar >= 0)

    if (!branchVersionId) {
      return NextResponse.json({ error: 'branchVersionId is required' }, { status: 400 })
    }

    // ── Fetch branch (the version being applied) ──────────────────────────────
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

    // ── Fetch target version (explicit or default to main) ────────────────────
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
      if (target_version_id === branchVersionId) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [branchTrk, mainTrk]: [any[], any[]] = await Promise.all([
      supabase.from('tracks').select('*').eq('version_id', branchVersionId).order('position', { ascending: true }).then(r => r.data ?? []),
      supabase.from('tracks').select('*').eq('version_id', main.id).order('position', { ascending: true }).then(r => r.data ?? []),
    ])

    const branchNames = new Set(branchTrk.map((t: { name: string }) => t.name))

    // ── Track merge (two-way) ─────────────────────────────────────────────────
    // Start from the target's tracks; target-only tracks are kept unless the
    // user explicitly opted into removing them (and removal only ever applies
    // to tracks the version does NOT contain — a version-side track can't be
    // "removed", only skipped).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mergedMap = new Map<string, any>()
    for (const t of mainTrk) {
      if (!branchNames.has(t.name) && removedTrackSet.has(t.name)) continue
      mergedMap.set(t.name, t)
    }

    for (const bt of branchTrk) {
      // Cherry-pick: user chose to keep the target's state for this track
      if (skippedTrackSet.has(bt.name)) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mt: any | undefined = mainTrk.find((t: { name: string }) => t.name === bt.name)

      if (!mt) {
        // Only in the version → plain addition
        mergedMap.set(bt.name, bt)
        continue
      }

      const fileDiffers   = mt.file_hash !== bt.file_hash
      const nameDiffers   = (mt.display_name ?? mt.name) !== (bt.display_name ?? bt.name)
      const offsetDiffers = trackStartBar(mt) !== trackStartBar(bt)

      if (!fileDiffers && !nameDiffers && !offsetDiffers) continue // identical — keep target row

      const fileSource    = fileDiffers ? bt : mt
      const finalName     = nameDiffers ? (bt.display_name ?? null) : (mt.display_name ?? null)
      const finalStartBar = offsetDiffers ? trackStartBar(bt) : trackStartBar(mt)

      mergedMap.set(bt.name, {
        ...fileSource,
        display_name: finalName,
        start_bar: finalStartBar,
        midi_start_bar: finalStartBar,
      })
    }

    // Build final ordered track list: tracks the target already had keep the
    // TARGET's mixer order (matched by name — a track whose audio was taken
    // from the version carries a branch row id, so id-based matching would
    // wrongly push it to the bottom); version-only tracks follow in the
    // version's order.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalTracks: any[] = Array.from(mergedMap.values())
    const mainPosByName = new Map(mainTrk.map((t: { name: string; position: number }) => [t.name, t.position]))
    finalTracks.sort((a, b) => {
      const aMainPos = mainPosByName.get(a.name)
      const bMainPos = mainPosByName.get(b.name)
      if (aMainPos !== undefined && bMainPos !== undefined) return aMainPos - bMainPos
      if (aMainPos !== undefined) return -1
      if (bMainPos !== undefined) return 1
      return a.position - b.position
    })

    // Wipe target tracks and insert merged set
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

    // ── Section merge (two-way, per bar) ──────────────────────────────────────
    const [branchSections, mainSections] = await Promise.all([
      supabase.from('sections').select('*').eq('version_id', branchVersionId).then(r => r.data ?? []),
      supabase.from('sections').select('*').eq('version_id', main.id).then(r => r.data ?? []),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const totalBars = calculateTotalBars(branchSections as any[], mainSections as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const branchMap = buildBarMap(branchSections as any[], totalBars)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mainMap   = buildBarMap(mainSections   as any[], totalBars)

    // Bar-coverage skips: any bar inside a skipped range keeps the target's
    // state, even if the diff ranges drifted since the preview was computed.
    const skippedBars = new Set<number>()
    for (const s of skippedSections) {
      const from = Math.max(0, s.startBar)
      const to   = Math.min(totalBars, s.endBar)
      for (let b = from; b < to; b++) skippedBars.add(b)
    }

    const finalMap: (BarState | null)[] = [...mainMap]
    for (const range of diffBarMaps(branchMap, mainMap, totalBars)) {
      for (let b = range.startBar; b < range.endBar; b++) {
        if (skippedBars.has(b)) continue
        finalMap[b] = branchMap[b]
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

    // ── Mark branch as merged ─────────────────────────────────────────────────
    const { error: mergeErr } = await supabase
      .from('versions')
      .update({ merged_at: new Date().toISOString(), merged_into_id: main.id })
      .eq('id', branchVersionId)
    if (mergeErr) throw mergeErr

    // ── Copy comments to the new target snapshot ──────────────────────────────
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

    // Content fingerprint — identical to the preview's detection, so what the
    // user reviewed as added/deleted is exactly what happens here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commentKey = (c: any): string =>
      `${c.created_by}|${c.timecode_start_ms}|${c.timecode_end_ms}|${c.content}`
    const branchCommentKeys = new Set(branchComments.map(commentKey))
    const mainCommentKeys   = new Set(mainComments.map(commentKey))

    for (const c of mainComments) {
      const track = mainTrk.find((t: { id: string }) => t.id === c.track_id)
      if (!track) continue
      // Cherry-pick: this comment's deletion (made in the version) is applied
      if (appliedDeletedCommentSet.has(c.id)) continue
      // Bulk choice: apply every deletion detected in the version
      if (commentDeletionChoice === 'apply' && !branchCommentKeys.has(commentKey(c))) continue
      allCommentsToCopy.push({ oldId: c.id, trackName: track.name, comment: c })
    }

    // Version comments the target doesn't have (fingerprint mismatch) = added.
    for (const c of branchComments) {
      if (mainCommentKeys.has(commentKey(c))) continue   // unchanged — already carried over above
      // Cherry-pick: user chose not to bring this comment over
      if (skippedAddedCommentSet.has(c.id)) continue
      const track = branchTrk.find((t: { id: string }) => t.id === c.track_id)
      if (!track) continue
      // Note: comments on skipped *new* tracks are dropped naturally below —
      // the track name won't exist in the merged target.
      allCommentsToCopy.push({ oldId: c.id, trackName: track.name, comment: c })
    }

    if (allCommentsToCopy.length > 0) {
      // Filter BEFORE insert while keeping (oldId ↔ row) pairs together, so the
      // inserted-id ↔ old-id mapping used for replies can never misalign.
      const rowsToInsert = allCommentsToCopy.flatMap(({ oldId, comment, trackName }) => {
        const newTrackId = newTrackByName.get(trackName)
        if (!newTrackId) return []
        const { id: _id, track_id: _ti, version_id: _vi, ...rest } = comment as { id: string; track_id: string; version_id: string; [k: string]: unknown }
        return [{ oldId, row: { ...rest, track_id: newTrackId, version_id: main.id } }]
      })

      if (rowsToInsert.length > 0) {
        const { data: insertedComments } = await supabase
          .from('track_comments')
          .insert(rowsToInsert.map(r => r.row))
          .select('id')

        if (insertedComments) {
          rowsToInsert.forEach(({ oldId }, i) => {
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

    // Merging a branch changes the target version's track set — mark preview stale.
    void markPreviewMixStale(projectId)

    // Log activity (fire-and-forget)
    const targetName = (main?.name as string | undefined) ?? 'main'
    supabase
      .from('projects').select('band_id, name').eq('id', projectId).maybeSingle()
      .then(({ data: proj }) => {
        if (proj) logActivity({
          bandId: proj.band_id, userId, action: 'merge',
          subject: `${branch.name} → ${targetName}`, projectId,
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

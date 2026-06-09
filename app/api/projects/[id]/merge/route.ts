import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/projects/[id]/merge
// Merges a branch into main:
//   1. Deletes all tracks on main
//   2. Copies branch tracks into main (pointer copy)
//   3. Marks branch as merged
// Body: { branch_id: string }
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

    // Find main version
    const { data: main, error: mainErr } = await supabase
      .from('versions')
      .select('*')
      .eq('project_id', projectId)
      .eq('type', 'main')
      .single()
    if (mainErr) throw mainErr

    // Verify branch belongs to project
    const { data: branch, error: branchErr } = await supabase
      .from('versions')
      .select('*')
      .eq('id', branch_id)
      .eq('project_id', projectId)
      .single()
    if (branchErr) return NextResponse.json({ error: 'branch not found' }, { status: 404 })

    // Wipe main tracks
    const { error: delErr } = await supabase
      .from('tracks')
      .delete()
      .eq('version_id', main.id)
    if (delErr) throw delErr

    // Copy branch tracks → main
    const { data: branchTracks, error: trkErr } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', branch_id)
    if (trkErr) throw trkErr

    if (branchTracks && branchTracks.length > 0) {
      const copies = branchTracks.map(({ id: _id, created_at: _ca, ...t }: { id: string; created_at: string; [k: string]: unknown }) => ({
        ...t,
        version_id: main.id,
      }))
      const { error: insertErr } = await supabase.from('tracks').insert(copies)
      if (insertErr) throw insertErr
    }

    // Mark branch as merged
    const { error: mergeErr } = await supabase
      .from('versions')
      .update({ merged_at: new Date().toISOString() })
      .eq('id', branch_id)
    if (mergeErr) throw mergeErr

    return NextResponse.json({ merged: true, main_id: main.id })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

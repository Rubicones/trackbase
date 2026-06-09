import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/projects/[id]/versions
// Creates a new branch from an existing version.
// Body: { name: string, parent_id: string }
// Copies all tracks from parent_id into the new version (same storage_path — no file copy).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params
    const { name, parent_id } = await req.json()

    if (!name || !parent_id) {
      return NextResponse.json(
        { error: 'name and parent_id are required' },
        { status: 400 }
      )
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
      .insert({ project_id: projectId, parent_id, name, type: 'branch' })
      .select()
      .single()
    if (verErr) throw verErr

    // Copy tracks from parent (pointer copy — same file_hash/storage_path)
    const { data: parentTracks, error: trkErr } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', parent_id)
    if (trkErr) throw trkErr

    if (parentTracks && parentTracks.length > 0) {
      const copies = parentTracks.map(({ id: _id, created_at: _ca, ...t }: { id: string; created_at: string; [k: string]: unknown }) => ({
        ...t,
        version_id: version.id,
      }))
      const { error: insertErr } = await supabase.from('tracks').insert(copies)
      if (insertErr) throw insertErr
    }

    return NextResponse.json({ version }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

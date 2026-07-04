import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForVersion } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

// PATCH /api/versions/[id] — rename a branch
// Body: { name: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: versionId } = await params

    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const { data: version, error: verErr } = await supabase
      .from('versions')
      .select('id, type, name')
      .eq('id', versionId)
      .single()
    if (verErr || !version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (version.type === 'main') {
      return NextResponse.json({ error: 'Master cannot be renamed' }, { status: 400 })
    }

    let body: { name?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (name.length > 60) return NextResponse.json({ error: 'name must be 60 characters or fewer' }, { status: 400 })
    if (name.toLowerCase() === 'master') {
      return NextResponse.json(
        { error: '"Master" is reserved for the primary version. Try another name.' },
        { status: 400 },
      )
    }

    const { data: updated, error } = await supabase
      .from('versions')
      .update({ name })
      .eq('id', versionId)
      .select()
      .single()
    if (error) throw error

    void logActivity({
      bandId: project.band_id, userId, action: 'branch_rename',
      subject: `${version.name} → ${name}`, projectId: project.id,
    })

    return NextResponse.json({ version: updated })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/versions/[id] — permanently delete a branch (master cannot be deleted)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: versionId } = await params

    const access = await requireBandMemberForVersion(req, versionId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    const { data: version, error: verErr } = await supabase
      .from('versions')
      .select('id, type, name, parent_id')
      .eq('id', versionId)
      .single()
    if (verErr || !version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (version.type === 'main') {
      return NextResponse.json({ error: 'The Master version cannot be deleted' }, { status: 400 })
    }

    // Reparent any branches created from this one, so the ancestry chain
    // (used for merge-base lookups) stays connected after this version is gone.
    await supabase
      .from('versions')
      .update({ parent_id: version.parent_id })
      .eq('parent_id', versionId)

    // Clear dangling merge-target references pointing at this version.
    await supabase
      .from('versions')
      .update({ merged_into_id: null })
      .eq('merged_into_id', versionId)

    const { data: tracks } = await supabase
      .from('tracks')
      .select('id')
      .eq('version_id', versionId)
    const trackIds = (tracks ?? []).map(t => t.id)

    const { data: comments } = await supabase
      .from('track_comments')
      .select('id')
      .eq('version_id', versionId)
    const commentIds = (comments ?? []).map(c => c.id)

    if (commentIds.length > 0) {
      await supabase.from('comment_replies').delete().in('comment_id', commentIds)
    }
    await supabase.from('track_comments').delete().eq('version_id', versionId)
    await supabase.from('sections').delete().eq('version_id', versionId)
    if (trackIds.length > 0) {
      await supabase.from('tracks').delete().eq('version_id', versionId)
    }

    const { error: delErr } = await supabase.from('versions').delete().eq('id', versionId)
    if (delErr) throw delErr

    void logActivity({
      bandId: project.band_id, userId, action: 'branch_remove',
      subject: version.name, projectId: project.id,
    })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

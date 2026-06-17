import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'

const LIMIT_BYTES = 500 * 1024 * 1024 // 500 MB

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  // Get all version IDs for this project
  const { data: versions } = await supabase
    .from('versions')
    .select('id')
    .eq('project_id', projectId)

  const versionIds = (versions ?? []).map((v: { id: string }) => v.id)
  if (!versionIds.length) {
    return NextResponse.json({ used_bytes: 0, limit_bytes: LIMIT_BYTES })
  }

  // Get all tracks; deduplicate by file_hash
  const { data: tracks } = await supabase
    .from('tracks')
    .select('file_hash, file_size_bytes')
    .in('version_id', versionIds)

  const seen = new Set<string>()
  let usedBytes = 0
  for (const t of tracks ?? []) {
    if (t.file_hash && !seen.has(t.file_hash)) {
      seen.add(t.file_hash)
      usedBytes += t.file_size_bytes ?? 0
    }
  }

  return NextResponse.json({ used_bytes: usedBytes, limit_bytes: LIMIT_BYTES })
}

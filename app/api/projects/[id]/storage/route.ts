import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { BAND_STORAGE_LIMIT_BYTES, getBandStorageUsed } from '@/lib/bandStorage'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  const usedBytes = await getBandStorageUsed(supabase, access.project.band_id)

  return NextResponse.json({
    used_bytes: usedBytes,
    limit_bytes: BAND_STORAGE_LIMIT_BYTES,
    band_id: access.project.band_id,
  })
}

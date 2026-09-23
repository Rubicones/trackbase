import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { getBandStorageUsed } from '@/lib/bandStorage'
import { getBandEntitlements } from '@/lib/entitlements'
import { mbToBytes } from '@/lib/plans'

// GET /api/projects/[id]/storage — this band's usage and ceiling.
//
// The ceiling comes from the BAND OWNER's plan plus this band's extra_storage
// addons, so a member on the free plan inside a Band+ owner's band sees (and
// gets) the band's real 50 GB. Storage is per band and is never pooled: this
// number describes one band and nothing else.
//
// Display only. The mixer renders the bar from these values; the server
// re-derives them on every upload and never trusts what comes back.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

  const bandId = access.project.band_id
  const [usedBytes, entitlements] = await Promise.all([
    getBandStorageUsed(supabase, bandId),
    getBandEntitlements(bandId),
  ])

  return NextResponse.json({
    used_bytes: usedBytes,
    // null = unlimited; the client falls back to its own display default.
    limit_bytes: mbToBytes(entitlements.storagePerBandMB),
    band_id: bandId,
  })
}

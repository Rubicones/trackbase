import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { getUserBandCount, getUserPendingJoinRequestCount } from '@/lib/bandAccess'


// GET /api/me/setup-status — routing helper for onboarding
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [bandCount, pendingCount] = await Promise.all([
    getUserBandCount(userId),
    getUserPendingJoinRequestCount(userId),
  ])

  return NextResponse.json({
    band_count: bandCount,
    pending_request_count: pendingCount,
    needs_band_setup: bandCount === 0 && pendingCount === 0,
    can_use_app: bandCount > 0 || pendingCount > 0,
  })
}

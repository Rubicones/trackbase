import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { getBandLimitStatus } from '@/lib/bandLimit'

// GET /api/me/band-limit — the acting user's band allowance and owned count.
//
// Display only. The client reads these values to lock the create action and
// explain why; it never sends them back. Enforcement is in POST /api/bands and
// POST /api/projects (and in the DB trigger behind them).
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const status = await getBandLimitStatus(userId)
    return NextResponse.json(status)
  } catch (err) {
    console.error('[me/band-limit]', err)
    return NextResponse.json({ error: 'Could not read band limit' }, { status: 500 })
  }
}

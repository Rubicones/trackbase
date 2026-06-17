import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { getUserBandCount, getUserPendingJoinRequestCount } from '@/lib/bandAccess'

function getUserId(req: NextRequest) {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

const adminSupabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

// GET /api/me/join-requests — current user's pending join requests
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: requests, error } = await adminSupabase
    .from('band_join_requests')
    .select('id, band_id, status, created_at, bands(name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    requests: (requests ?? []).map(r => {
      const band = r.bands as unknown as { name: string } | { name: string }[] | null
      const bandName = Array.isArray(band) ? band[0]?.name : band?.name
      return {
        id: r.id,
        band_id: r.band_id,
        band_name: bandName ?? 'Band',
        status: r.status,
        created_at: r.created_at,
      }
    }),
  })
}

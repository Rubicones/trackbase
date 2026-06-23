import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { clientRateLimitKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// GET /api/auth/username-check?username=foo
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = rateLimit(clientRateLimitKey(req, 'username-check'), 30, 60_000)
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec)

  const username = req.nextUrl.searchParams.get('username')?.trim().toLowerCase()
  if (!username) {
    return NextResponse.json({ available: false })
  }
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ available: false })
  }

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .neq('id', userId)
    .maybeSingle()

  return NextResponse.json({ available: !data })
}

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'

const VALID_PLANS = ['solo', 'band', 'band_plus'] as const
type PaidPlan = (typeof VALID_PLANS)[number]

/**
 * POST /api/paywall/intent
 * Records a purchase intent from the test-mode paywall.
 *
 * Body: { plan: 'solo' | 'band' | 'band_plus' }
 * Upserts into subscription_intents on (user_id, plan) — the same user
 * subscribing to the same plan twice never creates a duplicate row.
 *
 * This is bookkeeping only. There is no entitlement, no billing, no gating.
 */
export async function POST(req: NextRequest) {
  const user = await getRequestUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: { plan?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* handled below */
  }

  const plan = body.plan
  if (!plan || !VALID_PLANS.includes(plan as PaidPlan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  // Email comes from the auth record server-side — never from the client.
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(user.id)
  const email = authUser?.user?.email
  if (authErr || !email) {
    return NextResponse.json({ error: 'Could not resolve account email' }, { status: 500 })
  }

  const { error } = await supabase
    .from('subscription_intents')
    .upsert(
      { user_id: user.id, plan, email },
      { onConflict: 'user_id,plan' },
    )

  if (error) {
    console.error('[paywall] subscription_intents upsert failed:', error.message)
    return NextResponse.json({ error: 'Failed to record intent' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

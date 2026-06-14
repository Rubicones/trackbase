import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// PATCH /api/profile/onboarding
// Body: { key: string, value: boolean }
// Updates profiles.onboarding[key] = value for the current user
export async function PATCH(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { key, value } = body

  if (typeof key !== 'string' || typeof value !== 'boolean') {
    return NextResponse.json({ error: 'Invalid body — expected { key: string, value: boolean }' }, { status: 400 })
  }

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )

  // Fetch current onboarding state
  const { data: profile, error: fetchErr } = await adminSupabase
    .from('profiles')
    .select('onboarding')
    .eq('id', userId)
    .single()

  if (fetchErr) {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 })
  }

  const current = (profile?.onboarding as Record<string, boolean> | null) ?? {}
  const updated = { ...current, [key]: value }

  const { error: updateErr } = await adminSupabase
    .from('profiles')
    .update({ onboarding: updated })
    .eq('id', userId)

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to update onboarding' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, onboarding: updated })
}

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'

// POST /api/profile/complete-onboarding — mark onboarding_complete in user metadata
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in. Please sign in again.' }, { status: 401 })
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { onboarding_complete: true },
  })

  if (error) {
    console.error('[profile/complete-onboarding] error:', error)
    return NextResponse.json({ error: 'Could not complete onboarding' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

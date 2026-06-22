import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// PATCH /api/profile/username — set username during onboarding
export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in. Please sign in again.' }, { status: 401 })
  }

  let body: { username?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const username = body.username?.trim().toLowerCase() ?? ''
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3–20 characters — letters, numbers, underscores only' },
      { status: 400 },
    )
  }

  const { data: taken } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .neq('id', userId)
    .maybeSingle()

  if (taken) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ username })
    .eq('id', userId)

  if (profileErr) {
    if (profileErr.code === '23505') {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
    }
    console.error('[profile/username] profile update error:', profileErr)
    return NextResponse.json({ error: 'Could not save username' }, { status: 500 })
  }

  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { username },
  })

  if (metaErr) {
    console.error('[profile/username] metadata update error:', metaErr)
    return NextResponse.json({ error: 'Could not save username' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, username })
}

import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { clearAuthCookieOptions } from '@/lib/auth/cookie-options'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/session'

/**
 * DELETE /api/profile/account
 * Permanently deletes the authenticated user.
 *
 * - Bands where the user is the sole owner are deleted (cascades projects/tracks).
 * - Membership in other bands is removed.
 * - Auth user + profile are deleted (profile cascades from auth.users).
 */
export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in. Please sign in again.' }, { status: 401 })
  }

  let body: { confirmUsername?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body ok — still require confirm below */
  }

  const confirmUsername = body.confirmUsername?.trim().toLowerCase() ?? ''
  if (!confirmUsername) {
    return NextResponse.json({ error: 'Type your username to confirm deletion' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle()

  if (!profile || profile.username.toLowerCase() !== confirmUsername) {
    return NextResponse.json({ error: 'Username does not match' }, { status: 400 })
  }

  const { data: memberships } = await supabase
    .from('band_members')
    .select('band_id, role')
    .eq('user_id', userId)

  for (const m of memberships ?? []) {
    if (m.role === 'owner') {
      const { count } = await supabase
        .from('band_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('band_id', m.band_id)
        .eq('role', 'owner')

      if ((count ?? 0) <= 1) {
        const { error: bandErr } = await supabase.from('bands').delete().eq('id', m.band_id)
        if (bandErr) {
          console.error('[profile/account] sole-owner band delete failed:', bandErr)
          return NextResponse.json(
            { error: 'Could not delete a band you solely own. Try deleting it from the dashboard first.' },
            { status: 500 },
          )
        }
        continue
      }
    }

    const { error: leaveErr } = await supabase
      .from('band_members')
      .delete()
      .eq('band_id', m.band_id)
      .eq('user_id', userId)

    if (leaveErr) {
      console.error('[profile/account] leave band failed:', leaveErr)
      return NextResponse.json({ error: 'Could not leave a band before deleting account' }, { status: 500 })
    }
  }

  const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId)
  if (deleteErr) {
    console.error('[profile/account] auth delete failed:', deleteErr)
    return NextResponse.json({ error: 'Could not delete account' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(ACCESS_COOKIE, '', clearAuthCookieOptions())
  res.cookies.set(REFRESH_COOKIE, '', clearAuthCookieOptions())
  return res
}

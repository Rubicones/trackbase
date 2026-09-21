import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { clearAuthCookieOptions } from '@/lib/auth/cookie-options'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/session'
import { cancelSubscriptionsForAccountDeletion } from '@/lib/billing/store'

/**
 * DELETE /api/profile/account
 * Permanently deletes the authenticated user.
 *
 * - Any live Stripe subscription is cancelled FIRST (see below).
 * - Bands where the user is the sole owner are deleted (cascades projects/tracks).
 * - Membership in other bands is removed.
 * - Auth user + profile are deleted (profile cascades from auth.users).
 *
 * ── Billing comes first, and its failure is fatal ───────────────────────────
 * `billing_customers.user_id` references `auth.users(id) on delete cascade`,
 * so deleting the auth user destroys the only `stripe_customer_id → user_id`
 * link in the system. Stripe does not know that happened: the subscription
 * renews on schedule, the card is charged, and each resulting webhook resolves
 * to no user and is logged and dropped. The result is a customer charged
 * indefinitely with no record connecting the charge to them.
 *
 * So the cancellation runs before anything is destroyed, and a failure stops
 * the deletion outright rather than being logged and stepped over. The two
 * failure modes are not comparable: a user who cannot delete their account
 * today can be helped tomorrow; a deleted account that keeps being charged
 * cannot be traced from this side at all.
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

  // ── Stop the billing before destroying anything ───────────────────────────
  // Deliberately ahead of the band deletions, not just ahead of the auth
  // delete: if this fails the account must be exactly as it was, and a band
  // already deleted is not something the user can undo by retrying.
  try {
    await cancelSubscriptionsForAccountDeletion(userId)
  } catch (err) {
    console.error('[profile/account] subscription cancellation failed:', err)
    return NextResponse.json(
      {
        error:
          'Could not cancel your subscription, so the account was not deleted — ' +
          'nothing has been removed. Try again in a moment, or cancel from the ' +
          'billing portal first.',
      },
      { status: 502 },
    )
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

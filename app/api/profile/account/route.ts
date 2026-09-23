import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { clearAuthCookieOptions } from '@/lib/auth/cookie-options'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/session'
import { cancelSubscriptionsForAccountDeletion } from '@/lib/billing/store'
import {
  accountOwnsBandsBody,
  listOwnedBandsForDeletion,
  type OwnedSpace,
} from '@/lib/bandDelete'

/**
 * DELETE /api/profile/account
 * Permanently deletes the authenticated user.
 *
 * - REFUSED outright while the user owns any space (see below).
 * - Any live Stripe subscription is cancelled first among the destructive steps.
 * - Membership in other people's spaces is removed.
 * - Auth user + profile are deleted (profile cascades from auth.users).
 *
 * ── Owning a space blocks deletion, and nothing is cleaned up for you ───────
 * This route used to delete every solely-owned space as a side effect. One
 * confirmation dialog here destroyed every collaborator's tracks, comments and
 * versions in every one of those spaces, and told none of them. Worse, it is
 * also how a space became ownerless: `band_members` cascades from
 * `auth.users`, so deleting a user who co-owned a space silently removed the
 * owner row and left a space nobody could administer or freeze.
 *
 * So it refuses, and names the spaces. Clearing them means deleting each one,
 * which in turn means emptying it, which means removing each person — and each
 * removal tells that person. The chain is the feature.
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

  // ── Refuse before anything irreversible, including the Stripe call ───────
  //
  // Ordering matters more than it looks. Cancelling the subscription is the
  // first DESTRUCTIVE step, and it stays first among those — but a validation
  // that can refuse has to run ahead of it. Checked after, a refused deletion
  // would already have cancelled the person's subscription and then told them
  // their account could not be deleted.
  let owned: OwnedSpace[]
  try {
    owned = await listOwnedBandsForDeletion(userId)
  } catch (err) {
    console.error('[profile/account] could not read owned spaces:', err)
    return NextResponse.json(
      { error: 'Could not check which spaces you own. Nothing has been changed.' },
      { status: 500 },
    )
  }
  if (owned.length > 0) {
    return NextResponse.json(accountOwnsBandsBody(owned), { status: 409 })
  }

  // ── Stop the billing before destroying anything ───────────────────────────
  // If this fails the account must be exactly as it was.
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

  // Leave everyone else's spaces. By here the user owns none, so every row
  // removed is a plain membership and no space can be left ownerless.
  //
  // `band_members` would cascade from `auth.users` anyway; doing it explicitly
  // keeps the failure reportable, and keeps the cascade from being the thing
  // that has to be correct.
  const { error: leaveErr } = await supabase
    .from('band_members')
    .delete()
    .eq('user_id', userId)

  if (leaveErr) {
    console.error('[profile/account] leaving spaces failed:', leaveErr)
    return NextResponse.json(
      { error: 'Could not leave your spaces before deleting the account. Nothing was deleted.' },
      { status: 500 },
    )
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

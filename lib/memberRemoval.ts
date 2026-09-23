/**
 * Telling someone they were removed from a space.
 *
 * Removing members is now the path an owner MUST walk before a space can be
 * deleted (`lib/bandDelete.ts`), which turns it from a rare administrative
 * action into the common one. A step people are pushed through has to be
 * humane, and the humane part is that the person removed hears about it from
 * the product rather than by finding the space gone.
 *
 * Two things must be said, and they must be said identically to both sides —
 * which is why the sentences live in `lib/memberRemovalCopy.ts` rather than in
 * a component or a template. The owner's confirmation dialog and the removed
 * person's email read the same constant, so the promise made to the owner at
 * the moment of clicking is the promise delivered to the person at the other
 * end.
 *
 * ⚠ THIS MODULE IS SERVER-ONLY. It pulls in the Supabase admin client,
 * `lib/email.ts` and `web-push`, which needs Node's `net`. A client component
 * that imports anything from here — even a string constant — fails the build
 * with `Module not found: Can't resolve 'net'`. Import the copy from
 * `lib/memberRemovalCopy.ts` instead; that file has no imports for exactly
 * this reason.
 */

import { supabase } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { sendPushNotification } from '@/lib/push/server'
import { getSiteUrl } from '@/lib/site-url'
import { REMOVAL_CONSEQUENCE, REMOVAL_CONSEQUENCE_SELF } from '@/lib/memberRemovalCopy'

export { REMOVAL_CONSEQUENCE, REMOVAL_CONSEQUENCE_SELF }

export interface RemovalNotice {
  bandId: string
  bandName: string
  removedUserId: string
  /** Display name of whoever did it. Named, because "you were removed" is worse. */
  removedByName: string
}

/**
 * Best effort, always. Never throws, never reports failure upward.
 *
 * The removal has already happened and is correct; a notification that could
 * undo it would be a worse bug than one that goes missing. Failures are logged
 * — and with no mail provider configured yet, `sendEmail` logs the whole
 * message, which is currently the only trace that anyone was told.
 */
export async function notifyMemberRemoved(notice: RemovalNotice): Promise<void> {
  const { bandId, bandName, removedUserId, removedByName } = notice

  try {
    const body =
      `${removedByName} removed you from “${bandName}” on sonicdesk.\n\n` +
      `${REMOVAL_CONSEQUENCE_SELF}\n\n` +
      `If this looks like a mistake, ask ${removedByName} to invite you back — ` +
      `re-joining restores your access to everything there.\n\n` +
      getSiteUrl()

    // Email address lives in auth, not in `profiles`.
    const { data, error } = await supabase.auth.admin.getUserById(removedUserId)
    const address = data?.user?.email

    if (error) {
      console.error('[members/remove] could not read the removed user:', error)
    } else if (!address) {
      console.warn(`[members/remove] no email on file for ${removedUserId}; email skipped`)
    } else {
      await sendEmail({
        to: address,
        subject: `You were removed from ${bandName}`,
        body,
      })
    }

    // Push as well as mail, not instead of it: push is the channel this app
    // actually has today, and it reaches someone who has the tab open.
    await sendPushNotification(removedUserId, {
      title: `Removed from ${bandName}`,
      body: `${removedByName} removed you. Everything you uploaded stays with the space.`,
      url: getSiteUrl(),
    })
  } catch (err) {
    console.error('[members/remove] notification failed for', bandId, removedUserId, err)
  }
}

/** Display name for whoever performed the removal. Falls back, never throws. */
export async function actorDisplayName(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', userId)
      .maybeSingle()
    return data?.display_name?.trim() || data?.username?.trim() || 'A space owner'
  } catch {
    return 'A space owner'
  }
}

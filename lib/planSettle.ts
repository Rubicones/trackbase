/**
 * Settle an owner's account after something freed capacity.
 *
 * ⚠ SERVER ONLY.
 *
 * Freezing and grace are lazy by design (`lib/bandFreeze.ts`): there is no cron
 * job, and the state is re-derived whenever something asks. That is right for
 * the case nobody is watching, and wrong for the case where somebody just did
 * the thing the banner told them to do. Deleting a track to get back under a
 * storage ceiling, deleting a branch, deleting a band that resolved
 * `too_many_bands` — in each of those the user is looking at the screen, and
 * "your bands are frozen" must stop being true on the response to their own
 * action, not on whichever page load happened to call `settleAccount` next.
 *
 * ── Why the failure is swallowed ────────────────────────────────────────────
 * The delete has already succeeded and cannot be undone. Turning a successful
 * delete into a 500 because the bookkeeping that follows it failed would tell
 * the user their action did not happen, and they would do it again. Settling is
 * idempotent and runs from several other places, so a miss here costs a stale
 * banner until the next read — which is exactly the state this helper improves
 * on, never worse than it.
 */

import { getBandOwnerId } from '@/lib/entitlements'
import { settleAccount } from '@/lib/bandFreeze'

/**
 * Re-derive the plan state of the owner of `bandId`.
 *
 * Resolved from the band rather than from the acting user on purpose: limits
 * belong to the band OWNER, and the person deleting a track is very often a
 * member whose own plan has nothing to do with this band's ceiling.
 *
 * Never throws.
 */
export async function settleAfterFreeingSpace(bandId: string): Promise<void> {
  try {
    const ownerId = await getBandOwnerId(bandId)
    // An ownerless band is charged to nobody's plan — nothing to settle.
    if (!ownerId) return
    await settleAccount(ownerId)
  } catch (err) {
    console.warn('[planSettle] settle after delete failed for band', bandId, err)
  }
}

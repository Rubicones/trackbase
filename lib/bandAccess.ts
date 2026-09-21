import { supabase } from '@/lib/supabase'
import { ensureBandFreezeState } from '@/lib/bandFreeze'

/**
 * Band-level write guard.
 *
 * Project-scoped routes get the frozen-band block for free from
 * `requireBandMember` (it keys off the HTTP method). Band-level routes —
 * chat, members, join requests, invite codes, renaming the band — go through
 * `assertBandMember` / `assertBandOwner` instead, which have no request to
 * inspect, so they must call this explicitly before mutating.
 *
 * Returns true when the band is frozen, i.e. "refuse this write".
 */
export async function isBandFrozenForWrite(bandId: string): Promise<boolean> {
  const state = await ensureBandFreezeState(bandId)
  return state.frozen
}

export async function getBandMembership(bandId: string, userId: string) {
  const { data } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  return data
}

export async function assertBandMember(bandId: string, userId: string) {
  const member = await getBandMembership(bandId, userId)
  if (!member) return null
  return member
}

export async function assertBandOwner(bandId: string, userId: string) {
  const member = await getBandMembership(bandId, userId)
  if (!member || member.role !== 'owner') return null
  return member
}

/**
 * How many owners a band has. Ownership is `band_members.role = 'owner'`,
 * the same definition `lib/entitlements.ts` and the DB trigger use.
 */
export async function countBandOwners(bandId: string): Promise<number> {
  const { count } = await supabase
    .from('band_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('band_id', bandId)
    .eq('role', 'owner')
  return count ?? 0
}

/**
 * Refusal copy for "this would leave the band with no owner".
 *
 * Shared by the two routes that can remove a membership
 * (`DELETE /api/bands/[id]/members/me` and
 * `DELETE /api/bands/[id]/members/[userId]`) so they cannot drift apart — a
 * user who hits the same wall from the two buttons must read the same
 * sentence.
 *
 * It deliberately does NOT mention transferring ownership. No route in this
 * app writes `band_members.role`, so there is no transfer to perform and the
 * old copy ("Transfer ownership before leaving") sent people looking for a
 * screen that does not exist. What is actually possible: delete the space, or
 * leave once the band has a second owner — which the schema allows and no UI
 * currently creates.
 */
export const LAST_OWNER_REFUSAL =
  'You are the only owner of this space — removing you would leave it with none. ' +
  'Delete the space, or leave once it has another owner.'

export async function getUserBandCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('band_members')
    .select('band_id', { count: 'exact', head: true })
    .eq('user_id', userId)
  return count ?? 0
}

export async function getUserPendingJoinRequestCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('band_join_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
  return count ?? 0
}

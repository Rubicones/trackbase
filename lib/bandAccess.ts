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

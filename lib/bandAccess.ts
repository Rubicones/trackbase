import { supabase } from '@/lib/supabase'

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

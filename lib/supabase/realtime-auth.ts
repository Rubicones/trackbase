'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import { getBrowserAccessToken } from '@/lib/auth/browser-token'

/** Push the current user JWT onto the Realtime socket (required for RLS-protected tables). */
export async function syncSupabaseRealtimeAuth(accessToken?: string | null): Promise<boolean> {
  const token = accessToken ?? (await getBrowserAccessToken())
  if (!token) return false
  const supabase = getSupabaseClient()
  await supabase.realtime.setAuth(token)
  return true
}

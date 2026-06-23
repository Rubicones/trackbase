'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import { setAuthCookies } from '@/lib/auth/cookies'

/**
 * Restore the Supabase client session from HttpOnly cookies when localStorage is empty.
 * Returns true when a usable session is available afterward.
 */
export async function syncSupabaseSessionFromCookies(): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { data: { session: existing } } = await supabase.auth.getSession()
  if (existing?.access_token) return true

  const res = await fetch('/api/auth/session', { credentials: 'same-origin' })
  if (!res.ok) return false

  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string }
  if (!tokens.access_token || !tokens.refresh_token) return false

  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })
  if (error || !data.session) return false

  await setAuthCookies(data.session)
  return true
}

/** Access token for browser Realtime auth (Supabase client session only). */
export async function getBrowserAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

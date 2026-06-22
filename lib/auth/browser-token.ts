'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import { setAuthCookies } from '@/lib/auth/cookies'
import { ACCESS_COOKIE, REFRESH_COOKIE, decodeJwt } from '@/lib/auth/session'

/** Read a cookie value by name. */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return part.slice(prefix.length)
  }
  return null
}

/** Read the access-token cookie set by our auth flow (sb-at). */
export function readAccessCookie(): string | null {
  return readCookie(ACCESS_COOKIE)
}

/**
 * Restore the Supabase client session from sb-at / sb-rt cookies when out of sync.
 * Returns true when a usable session is available afterward.
 */
export async function syncSupabaseSessionFromCookies(): Promise<boolean> {
  const accessToken = readCookie(ACCESS_COOKIE)
  const refreshToken = readCookie(REFRESH_COOKIE)
  if (!accessToken || !refreshToken) return false

  const supabase = getSupabaseClient()
  const { data: { session: existing } } = await supabase.auth.getSession()
  if (existing?.access_token === accessToken) return true

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (error || !data.session) return false

  setAuthCookies(data.session)
  return true
}

/**
 * Best-effort access token for browser Realtime auth.
 * Prefers the Supabase client session; falls back to sb-at cookie (API auth path).
 */
export async function getBrowserAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token && decodeJwt(session.access_token)) {
    return session.access_token
  }

  const fromCookie = readAccessCookie()
  if (fromCookie && decodeJwt(fromCookie)) return fromCookie

  return null
}

'use client'

import { getSupabaseClient } from '@/lib/supabase/client'
import { ACCESS_COOKIE, decodeJwt } from '@/lib/auth/session'

/** Read the access-token cookie set by our auth flow (sb-at). */
export function readAccessCookie(): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${ACCESS_COOKIE}=`
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) return part.slice(prefix.length)
  }
  return null
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

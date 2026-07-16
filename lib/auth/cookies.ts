'use client'

/**
 * Mirror Supabase session tokens into HttpOnly cookies for server-side auth.
 * Tokens remain in the Supabase client (localStorage) for Realtime.
 *
 * Deduped per access_token via sessionStorage so a warm reload does not
 * POST /api/auth/session on every page when cookies are already in sync.
 */
const COOKIE_SYNC_KEY = 'tb_auth_cookie_at'

function readSyncedAccessToken(): string | null {
  try {
    return sessionStorage.getItem(COOKIE_SYNC_KEY)
  } catch {
    return null
  }
}

function writeSyncedAccessToken(accessToken: string | null) {
  try {
    if (accessToken) sessionStorage.setItem(COOKIE_SYNC_KEY, accessToken)
    else sessionStorage.removeItem(COOKIE_SYNC_KEY)
  } catch {
    /* private mode / blocked storage */
  }
}

export async function setAuthCookies(session: {
  access_token: string
  refresh_token: string
  expires_in?: number
}): Promise<void> {
  if (readSyncedAccessToken() === session.access_token) return

  await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
    }),
  })
  writeSyncedAccessToken(session.access_token)
}

export async function clearAuthCookies(): Promise<void> {
  writeSyncedAccessToken(null)
  await fetch('/api/auth/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  })
}

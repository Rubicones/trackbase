'use client'

/**
 * Mirror Supabase session tokens into HttpOnly cookies for server-side auth.
 * Tokens remain in the Supabase client (localStorage) for Realtime.
 */
export async function setAuthCookies(session: {
  access_token: string
  refresh_token: string
  expires_in?: number
}): Promise<void> {
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
}

export async function clearAuthCookies(): Promise<void> {
  await fetch('/api/auth/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  })
}

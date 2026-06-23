/** Verified Supabase user extracted from a valid access token. */
export interface VerifiedUser {
  id: string
  user_metadata?: {
    username?: string
    onboarding_complete?: boolean
    [k: string]: unknown
  }
}

/**
 * Validate an access token with Supabase Auth (signature + expiry).
 * Uses fetch so this works in Edge middleware and Node route handlers.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key || !token) return null

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: key,
      },
      cache: 'no-store',
    })
    if (!res.ok) return null

    const user = (await res.json()) as {
      id?: string
      user_metadata?: VerifiedUser['user_metadata']
    }
    if (!user.id) return null

    return { id: user.id, user_metadata: user.user_metadata }
  } catch {
    return null
  }
}

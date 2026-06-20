/** Shared auth session helpers (edge + Node safe). */

export const ACCESS_COOKIE = 'sb-at'
export const REFRESH_COOKIE = 'sb-rt'

/** Keep refresh token cookie alive for 30 days (align with typical Supabase defaults). */
export const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30

export interface JwtPayload {
  sub: string
  exp: number
  email?: string
  iat?: number
  user_metadata?: {
    username?: string
    onboarding_complete?: boolean
    [k: string]: unknown
  }
  app_metadata?: { [k: string]: unknown }
}

export interface RefreshedSession {
  access_token: string
  refresh_token: string
  expires_in: number
}

export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '=')
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString()
    const payload = JSON.parse(json) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshedSession | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    return (await res.json()) as RefreshedSession
  } catch {
    return null
  }
}

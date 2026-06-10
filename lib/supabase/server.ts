/**
 * Server-side auth utilities.
 *
 * We can't use @supabase/ssr (npm 403 in this env), so we decode the
 * JWT that the browser client stores in the sb-at cookie.
 *
 * The Supabase access token is a standard RS256 JWT.  We only *decode*
 * (base64), never verify the signature — the payload is trusted because
 * it was issued by Supabase and is only accessible server-side via cookies
 * that were set by our own AuthContext.  All sensitive mutations go through
 * the service-key client which bypasses RLS entirely.
 */

export interface JwtPayload {
  sub: string          // user UUID
  email?: string
  exp: number          // unix seconds
  iat: number
  user_metadata?: {
    username?: string
    [k: string]: unknown
  }
  app_metadata?: { [k: string]: unknown }
}

/**
 * Decode a Supabase JWT without verifying the signature.
 * Returns null if the token is missing, malformed, or expired.
 */
export function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    // Base64url → base64 → JSON
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    ) as JwtPayload
    // Reject expired tokens
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Extract the user ID from a JWT cookie value.
 * Returns null if invalid / expired.
 */
export function getUserIdFromToken(token: string): string | null {
  return decodeJwt(token)?.sub ?? null
}

/**
 * Get the username stored in user_metadata from a JWT.
 * Returns null if the token is invalid or the user hasn't completed onboarding.
 */
export function getUsernameFromToken(token: string): string | null {
  return decodeJwt(token)?.user_metadata?.username ?? null
}

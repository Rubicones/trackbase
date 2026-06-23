import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

type CookieOptions = Pick<
  ResponseCookie,
  'path' | 'httpOnly' | 'secure' | 'sameSite' | 'maxAge'
>

/** Shared options for auth session cookies set server-side. */
export function authCookieOptions(maxAge: number): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
  }
}

/** Clear auth cookies by setting maxAge to 0. */
export function clearAuthCookieOptions(): CookieOptions {
  return authCookieOptions(0)
}

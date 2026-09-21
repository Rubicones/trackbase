/**
 * "The band you had open", remembered per device.
 *
 * One cookie, written server-side the moment `GET /api/bands/[id]` answers
 * successfully — which is also the moment membership has just been proven, so
 * the value can never name a band the user was unable to open at least once.
 *
 * **Per device on purpose.** "Where was I on this machine" is a different
 * question from "where was I last", and dropping a phone into the band a
 * laptop happened to be in is a worse guess than the phone's own history. That
 * is also why this is a cookie rather than a column on `profiles`: no
 * migration, no query on the redirect path, and the right scope for free.
 *
 * **It is a redirect hint and nothing else.** Nothing reads it for
 * authorisation. `/open` re-checks membership against the database before it
 * sends anyone anywhere, so a forged, stale or deleted-band value costs one
 * redirect to the bands list and clears itself.
 */

import type { NextRequest, NextResponse } from 'next/server'

export const LAST_BAND_COOKIE = 'sd-last-band'

/** Six months. Long enough that "the app remembers" survives a holiday. */
export const LAST_BAND_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

/**
 * The default entry point for an authenticated user: last band, or the list.
 * Every surface that means "take me into the app" points here — post-login,
 * the installed PWA's `start_url`, the landing page's standalone redirect.
 * `/dashboard` keeps meaning "show me every band" and is never rewritten.
 */
export const ENTRY_PATH = '/open'

/** The bands list, and the fallback whenever there is no band to return to. */
export const BANDS_LIST_PATH = '/dashboard'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shape check only. It exists so a junk cookie never reaches a database query
 * or a URL, not to establish that the band exists or that anyone may see it.
 */
export function isBandId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function cookieOptions(maxAge: number) {
  return {
    path: '/',
    // Not a secret, but there is no client that needs to read it: it is written
    // by an API route and consumed by middleware and /open, both server-side.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
  }
}

/** The band id this device last opened, or null. */
export function readLastBandId(req: NextRequest): string | null {
  const value = req.cookies.get(LAST_BAND_COOKIE)?.value
  return isBandId(value) ? value : null
}

export function rememberLastBand(res: NextResponse, bandId: string): void {
  if (!isBandId(bandId)) return
  res.cookies.set(LAST_BAND_COOKIE, bandId, cookieOptions(LAST_BAND_COOKIE_MAX_AGE))
}

export function forgetLastBand(res: NextResponse): void {
  res.cookies.set(LAST_BAND_COOKIE, '', cookieOptions(0))
}

/** Where `/open` should send this request, given a validated band id or null. */
export function entryDestination(bandId: string | null): string {
  return bandId ? `/band/${bandId}` : BANDS_LIST_PATH
}

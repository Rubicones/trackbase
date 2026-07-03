import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  refreshAccessToken,
  type RefreshedSession,
} from '@/lib/auth/session'
import { authCookieOptions } from '@/lib/auth/cookie-options'
import { verifyAccessToken, type VerifiedUser } from '@/lib/auth/verify'
import { PRODUCTION_SITE_URL, REDIRECT_TO_CANONICAL_HOSTS } from '@/lib/site-url'

// ─── Route matchers ───────────────────────────────────────────────────────────

const PUBLIC_PREFIXES = ['/auth', '/api/auth']
const PUBLIC_EXACT = ['/']

const PROFILE_EXEMPT = ['/onboarding', '/auth', '/api/']

function isPublic(pathname: string) {
  return PUBLIC_EXACT.includes(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

function isProfileExempt(pathname: string) {
  return PROFILE_EXEMPT.some(p => pathname.startsWith(p))
}

function applyRefreshedCookies(res: NextResponse, session: RefreshedSession) {
  res.cookies.set(ACCESS_COOKIE, session.access_token, authCookieOptions(session.expires_in))
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, authCookieOptions(REFRESH_TOKEN_MAX_AGE))
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')?.split(':')[0] ?? ''

  // www + pre-rebrand domains → canonical host (301 so Google consolidates signals).
  if (REDIRECT_TO_CANONICAL_HOSTS.has(host)) {
    const dest = new URL(pathname + request.nextUrl.search, PRODUCTION_SITE_URL)
    return NextResponse.redirect(dest, 301)
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Legacy invite links — send to join flow (301: URL pattern permanently moved).
  if (pathname.startsWith('/invite/')) {
    return NextResponse.redirect(new URL('/onboarding?step=3', request.url), 301)
  }

  let verified: VerifiedUser | null = null
  let refreshedSession: RefreshedSession | null = null

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value
  if (accessToken) {
    verified = await verifyAccessToken(accessToken)
  }

  if (!verified) {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
    if (refreshToken) {
      refreshedSession = await refreshAccessToken(refreshToken)
      if (refreshedSession) {
        verified = await verifyAccessToken(refreshedSession.access_token)
      }
    }
  }

  const isAuthed = verified !== null
  const hasUsername = !!verified?.user_metadata?.username
  const onboardingComplete = !!verified?.user_metadata?.onboarding_complete

  function finalize(res: NextResponse) {
    if (refreshedSession) applyRefreshedCookies(res, refreshedSession)
    return res
  }

  if (isAuthed && pathname.startsWith('/auth')) {
    if (hasUsername && onboardingComplete) {
      return finalize(NextResponse.redirect(new URL('/dashboard', request.url)))
    }
    return finalize(NextResponse.redirect(new URL('/onboarding', request.url)))
  }

  if (isPublic(pathname)) return finalize(NextResponse.next())

  if (!isAuthed) {
    const url = new URL('/auth', request.url)
    url.searchParams.set('next', pathname)
    return finalize(NextResponse.redirect(url))
  }

  if (!hasUsername && !isProfileExempt(pathname)) {
    return finalize(NextResponse.redirect(new URL('/onboarding', request.url)))
  }

  if (hasUsername && !onboardingComplete && !isProfileExempt(pathname)) {
    const url = new URL('/onboarding', request.url)
    url.searchParams.set('step', '3')
    return finalize(NextResponse.redirect(url))
  }

  return finalize(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon).*)',
  ],
}

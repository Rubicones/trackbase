import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  decodeJwt,
  refreshAccessToken,
  type JwtPayload,
  type RefreshedSession,
} from '@/lib/auth/session'

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
  res.cookies.set(ACCESS_COOKIE, session.access_token, {
    path: '/',
    sameSite: 'lax',
    maxAge: session.expires_in,
  })
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    path: '/',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // Legacy invite links — send to join flow
  if (pathname.startsWith('/invite/')) {
    return NextResponse.redirect(new URL('/onboarding?step=3', request.url))
  }

  let token = request.cookies.get(ACCESS_COOKIE)?.value ?? null
  let payload: JwtPayload | null = token ? decodeJwt(token) : null
  let refreshedSession: RefreshedSession | null = null

  if (!payload) {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
    if (refreshToken) {
      refreshedSession = await refreshAccessToken(refreshToken)
      if (refreshedSession) {
        token = refreshedSession.access_token
        payload = decodeJwt(token)
      }
    }
  }

  const isAuthed = payload !== null
  const hasUsername = !!payload?.user_metadata?.username
  const onboardingComplete = !!payload?.user_metadata?.onboarding_complete

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

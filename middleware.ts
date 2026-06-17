import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ─── JWT decode (no signature verification — payload is already trusted) ──────

interface JwtPayload {
  sub: string
  exp: number
  user_metadata?: {
    username?: string
    onboarding_complete?: boolean
  }
}

function decodeJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const raw = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(raw.padEnd(raw.length + ((4 - (raw.length % 4)) % 4), '='))
    const payload = JSON.parse(json) as JwtPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ─── Route matchers ───────────────────────────────────────────────────────────

const PUBLIC_PREFIXES = ['/auth', '/api/auth']

const PROFILE_EXEMPT = ['/onboarding', '/auth', '/api/']

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

function isProfileExempt(pathname: string) {
  return PROFILE_EXEMPT.some(p => pathname.startsWith(p))
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
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

  const token = request.cookies.get('sb-at')?.value ?? null
  const payload = token ? decodeJwt(token) : null
  const isAuthed = payload !== null
  const hasUsername = !!payload?.user_metadata?.username
  const onboardingComplete = !!payload?.user_metadata?.onboarding_complete

  if (isAuthed && pathname.startsWith('/auth')) {
    if (hasUsername && onboardingComplete) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  if (isPublic(pathname)) return NextResponse.next()

  if (!isAuthed) {
    const url = new URL('/auth', request.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (!hasUsername && !isProfileExempt(pathname)) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  if (hasUsername && !onboardingComplete && !isProfileExempt(pathname)) {
    const url = new URL('/onboarding', request.url)
    url.searchParams.set('step', '3')
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ─── JWT decode (no signature verification — payload is already trusted) ──────

interface JwtPayload {
  sub: string
  exp: number
  user_metadata?: { username?: string }
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

// Public routes that never require auth
const PUBLIC_PREFIXES = ['/auth', '/invite', '/api/auth']

// Routes that even authenticated users without a profile can access
const PROFILE_EXEMPT = ['/onboarding', '/auth', '/invite', '/api/']

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
}

function isProfileExempt(pathname: string) {
  return PROFILE_EXEMPT.some(p => pathname.startsWith(p))
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Static assets / Next internals — skip
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  const token = request.cookies.get('sb-at')?.value ?? null
  const payload = token ? decodeJwt(token) : null
  const isAuthed = payload !== null
  const hasUsername = !!payload?.user_metadata?.username

  // ── Authenticated user on /auth → send to dashboard ──────────────────────
  if (isAuthed && pathname.startsWith('/auth')) {
    if (hasUsername) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  // ── Public routes — allow through ─────────────────────────────────────────
  if (isPublic(pathname)) return NextResponse.next()

  // ── Unauthenticated → /auth ───────────────────────────────────────────────
  if (!isAuthed) {
    const url = new URL('/auth', request.url)
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // ── Authenticated but no username → /onboarding ───────────────────────────
  if (!hasUsername && !isProfileExempt(pathname)) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files.
     * We filter /_next inside the middleware body for clarity.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

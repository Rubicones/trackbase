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
import {
  campaignSlugFromPath,
  CAMPAIGN_COOKIE,
  CAMPAIGN_COOKIE_MAX_AGE,
} from '@/lib/campaigns'
import {
  isLandingVariant,
  LANDING_VARIANT_COOKIE,
  LANDING_VARIANT_MAX_AGE,
  rollLandingVariant,
  SIMPLE_LANDING_PATH,
  type LandingVariant,
} from '@/lib/landingVariant'

// ─── Route matchers ───────────────────────────────────────────────────────────

const PUBLIC_PREFIXES = [
  '/auth',
  '/api/auth',
  '/features',
  '/audience',
  // Standalone SEO tools — no login required, no app shell.
  '/tools',
  '/api/tools',
]
const PUBLIC_EXACT = ['/', SIMPLE_LANDING_PATH]

const PROFILE_EXEMPT = ['/onboarding', '/auth', '/api/']

// Campaign paths are absent on purpose: they are intercepted above the auth
// gate entirely, so they never reach this check.
function isPublic(pathname: string) {
  return (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
  )
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

  // ── Campaign landing links ──────────────────────────────────────────────────
  // Handled entirely here: stamp the slug, bounce to the landing page. There is
  // no page component and no client render, which is the point —
  //   * no loading screen: the browser goes straight from the link to `/`;
  //   * attribution cannot be lost, because it never depended on a React effect
  //     running, or on storage being writable, in the first place.
  // 307 (not 301) on purpose: a permanent redirect would be cached by the
  // browser and later clicks would skip middleware, and with it the cookie.
  // First-touch — an existing cookie is never overwritten.
  const campaignSlug = campaignSlugFromPath(pathname)
  if (campaignSlug) {
    const res = NextResponse.redirect(new URL('/', request.url))
    if (!request.cookies.get(CAMPAIGN_COOKIE)?.value) {
      res.cookies.set(CAMPAIGN_COOKIE, campaignSlug, {
        // Readable by client code so the campaign is available to the browser
        // too (see lib/attribution.ts). The value is a registry slug, not a
        // secret, and the server re-resolves it rather than trusting it.
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: CAMPAIGN_COOKIE_MAX_AGE,
      })
    }
    return res
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

  // ── Landing A/B split ───────────────────────────────────────────────────────
  // Assign a visitor to `control` or `simple` once, remember it for a year, and
  // serve the assigned variant on every later visit. Registry and roll live in
  // `lib/landingVariant.ts`.
  //
  // Placed *after* the auth/refresh block above and wrapped in `finalize()` on
  // purpose: `/` has always passed through token verification and had a
  // refreshed session written back, and intercepting it earlier would silently
  // change that for signed-in visitors. This block only chooses which document
  // to serve.
  //
  // Rewrite, not redirect: the address bar keeps saying `/`, so the experiment
  // doesn't split inbound links or the analytics landing-page dimension across
  // two URLs, and there is no extra round-trip. Both documents are force-static,
  // so the rewrite just picks a different prerendered HTML file.
  if (pathname === '/' || pathname === SIMPLE_LANDING_PATH) {
    const assigned = request.cookies.get(LANDING_VARIANT_COOKIE)?.value

    // A direct hit on /simple (shared link) is honoured rather than re-rolled,
    // and pins the visitor so navigating away and back stays consistent.
    const variant: LandingVariant =
      pathname === SIMPLE_LANDING_PATH
        ? 'simple'
        : isLandingVariant(assigned)
          ? assigned
          : rollLandingVariant()

    const res =
      pathname === '/' && variant === 'simple'
        ? NextResponse.rewrite(new URL(SIMPLE_LANDING_PATH, request.url))
        : NextResponse.next()

    if (assigned !== variant) {
      res.cookies.set(LANDING_VARIANT_COOKIE, variant, {
        // Readable by client code: it is a bucket name, not a secret, and being
        // able to read it in the browser/devtools is what makes the split
        // debuggable. The rendered page passes its own variant to the
        // `landing_variant_viewed` event rather than reading this back, so
        // nothing depends on the cookie having landed.
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: LANDING_VARIANT_MAX_AGE,
      })
    }

    return finalize(res)
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

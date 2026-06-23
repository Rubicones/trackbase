import { NextRequest, NextResponse } from 'next/server'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  refreshAccessToken,
} from '@/lib/auth/session'
import { authCookieOptions, clearAuthCookieOptions } from '@/lib/auth/cookie-options'
import { verifyAccessToken } from '@/lib/auth/verify'

function applySessionCookies(
  res: NextResponse,
  session: { access_token: string; refresh_token: string; expires_in?: number },
) {
  const accessMaxAge = session.expires_in ?? 3600
  res.cookies.set(ACCESS_COOKIE, session.access_token, authCookieOptions(accessMaxAge))
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, authCookieOptions(REFRESH_TOKEN_MAX_AGE))
}

function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', clearAuthCookieOptions())
  res.cookies.set(REFRESH_COOKIE, '', clearAuthCookieOptions())
}

/**
 * POST /api/auth/session
 * Body: { access_token, refresh_token, expires_in? }
 * Sets HttpOnly session cookies after verifying the access token with Supabase.
 */
export async function POST(req: NextRequest) {
  let body: { access_token?: string; refresh_token?: string; expires_in?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { access_token, refresh_token, expires_in } = body
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: 'Missing tokens' }, { status: 400 })
  }

  const verified = await verifyAccessToken(access_token)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  applySessionCookies(res, { access_token, refresh_token, expires_in })
  return res
}

/** DELETE /api/auth/session — clear HttpOnly auth cookies. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  clearSessionCookies(res)
  return res
}

/**
 * GET /api/auth/session
 * Bootstrap the Supabase browser client from HttpOnly cookies when localStorage is empty.
 * Same-origin + credentials only; tokens are never logged.
 */
export async function GET(req: NextRequest) {
  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value
  if (accessToken) {
    const verified = await verifyAccessToken(accessToken)
    if (verified) {
      const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
      if (refreshToken) {
        return NextResponse.json(
          {
            access_token: accessToken,
            refresh_token: refreshToken,
          },
          {
            headers: {
              'Cache-Control': 'no-store',
              Pragma: 'no-cache',
            },
          },
        )
      }
    }
  }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const refreshed = await refreshAccessToken(refreshToken)
  if (!refreshed) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }

  const verified = await verifyAccessToken(refreshed.access_token)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const res = NextResponse.json(
    {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    },
  )
  applySessionCookies(res, refreshed)
  return res
}

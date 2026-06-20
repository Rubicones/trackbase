'use client'

import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
} from '@/lib/auth/session'

export function setAuthCookies(session: {
  access_token: string
  refresh_token: string
  expires_in?: number
}) {
  const accessMaxAge = session.expires_in ?? 3600
  document.cookie = `${ACCESS_COOKIE}=${session.access_token}; path=/; SameSite=Lax; max-age=${accessMaxAge}`
  document.cookie = `${REFRESH_COOKIE}=${session.refresh_token}; path=/; SameSite=Lax; max-age=${REFRESH_TOKEN_MAX_AGE}`
}

export function clearAuthCookies() {
  document.cookie = `${ACCESS_COOKIE}=; path=/; max-age=0`
  document.cookie = `${REFRESH_COOKIE}=; path=/; max-age=0`
}

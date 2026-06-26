/** Canonical production origin (custom domain). */
export const PRODUCTION_SITE_URL = 'https://trackbase.studio'

const LOCAL_SITE_URL = 'http://localhost:3000'

/** Canonical app origin for auth redirects and share links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined') return window.location.origin
  if (process.env.NODE_ENV === 'production') return PRODUCTION_SITE_URL
  return LOCAL_SITE_URL
}

/** Post-auth magic-link callback URL. */
export function getAuthCallbackUrl(): string {
  return `${getSiteUrl()}/auth/callback`
}

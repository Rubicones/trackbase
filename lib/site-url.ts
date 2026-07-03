/** Canonical production origin (custom domain). */
export const PRODUCTION_SITE_URL = 'https://sonicdesk.studio'

const LOCAL_SITE_URL = 'http://localhost:3000'

/** Pre-rebrand hostnames — must never appear in canonicals, sitemaps, or auth links. */
export const LEGACY_SITE_HOSTS = new Set([
  'trackbase.studio',
  'www.trackbase.studio',
])

/** Non-canonical aliases that should 301 to PRODUCTION_SITE_URL. */
export const REDIRECT_TO_CANONICAL_HOSTS = new Set([
  ...LEGACY_SITE_HOSTS,
  'www.sonicdesk.studio',
])

function normalizeConfiguredOrigin(url: string): string {
  try {
    const { hostname, origin } = new URL(url)
    if (LEGACY_SITE_HOSTS.has(hostname)) return PRODUCTION_SITE_URL
    return origin
  } catch {
    return PRODUCTION_SITE_URL
  }
}

/**
 * Origin for SEO metadata (canonical, OG, sitemap, robots, JSON-LD).
 * On the production deployment this always resolves to sonicdesk.studio so a
 * stale NEXT_PUBLIC_SITE_URL (e.g. the pre-rebrand trackbase.studio) cannot
 * suppress indexing.
 */
export function getSeoOrigin(): string {
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_SITE_URL
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return normalizeConfiguredOrigin(fromEnv)
  if (process.env.NODE_ENV === 'production') return PRODUCTION_SITE_URL
  return LOCAL_SITE_URL
}

/** Canonical app origin for auth redirects and share links. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return normalizeConfiguredOrigin(fromEnv)
  if (typeof window !== 'undefined') return window.location.origin
  if (process.env.NODE_ENV === 'production') return PRODUCTION_SITE_URL
  return LOCAL_SITE_URL
}

/** Post-auth magic-link callback URL. */
export function getAuthCallbackUrl(): string {
  return `${getSiteUrl()}/auth/callback`
}

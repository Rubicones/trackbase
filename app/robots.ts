import type { MetadataRoute } from 'next'
import { getCanonicalUrl, getMetadataBase } from '@/lib/seo'

/** Public marketing surface only — app routes stay out of the index via noindex + disallow. */
const DISALLOWED_PREFIXES = [
  '/api/',
  '/auth/',
  '/band/',
  '/dashboard/',
  '/invite/',
  '/onboarding/',
  '/uikit/',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PREFIXES,
      },
    ],
    sitemap: getCanonicalUrl('/sitemap.xml'),
    host: getMetadataBase().origin,
  }
}

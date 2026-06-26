import type { MetadataRoute } from 'next'
import { getCanonicalUrl } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/band/',
          '/onboarding',
          '/auth',
          '/invite/',
          '/uikit',
          '/api/',
        ],
      },
    ],
    sitemap: getCanonicalUrl('/sitemap.xml'),
    host: getCanonicalUrl(),
  }
}

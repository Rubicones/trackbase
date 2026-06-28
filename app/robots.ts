import type { MetadataRoute } from 'next'
import { getCanonicalUrl } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: [
          '/',
        ],
      },
    ],
    sitemap: getCanonicalUrl('/sitemap.xml'),
    host: getCanonicalUrl(),
  }
}

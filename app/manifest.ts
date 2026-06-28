import type { MetadataRoute } from 'next'
import { SEO_DEFAULT_DESCRIPTION, SITE_NAME, SITE_SHORT_NAME } from '@/lib/seo'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: SEO_DEFAULT_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#070707',
    theme_color: '#DFFF00',
    lang: 'en',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  }
}

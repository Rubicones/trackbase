import type { MetadataRoute } from 'next'
import { getCanonicalUrl } from '@/lib/seo'

/** Marketing "slice" pages — one feature or one audience story each. */
const SLICE_PATHS = [
  '/features/versions',
  '/features/structure',
  '/features/mobile',
  '/features/comments',
  '/audience/cover-band',
  '/audience/indie-band',
  '/audience/producer',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: getCanonicalUrl('/'),
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...SLICE_PATHS.map((path) => ({
      url: getCanonicalUrl(path),
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
}

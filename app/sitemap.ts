import type { MetadataRoute } from 'next'
import { PRODUCTION_SITE_URL } from '@/lib/site-url'

/**
 * Marketing surface for Google. Uses a hard-coded production origin so the
 * route never depends on runtime env resolution (a past cause of intermittent
 * sitemap 500s / empty responses in GSC).
 *
 * lastModified is a stable content date — not `new Date()` per build — so
 * crawlers don't see perpetual "fresh" churn without real edits.
 */
const LAST_CONTENT_UPDATE = new Date('2026-07-06T00:00:00.000Z')

const ENTRIES: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/features/versions', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/features/structure', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/features/mobile', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/features/comments', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/audience/cover-band', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/audience/indie-band', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/audience/producer', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/tools/chord-detector', priority: 0.9, changeFrequency: 'monthly' },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return ENTRIES.map(({ path, priority, changeFrequency }) => ({
    url: path === '/' ? `${PRODUCTION_SITE_URL}/` : `${PRODUCTION_SITE_URL}${path}`,
    lastModified: LAST_CONTENT_UPDATE,
    changeFrequency,
    priority,
  }))
}

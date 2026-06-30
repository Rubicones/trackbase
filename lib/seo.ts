import type { Metadata } from 'next'
import { PRODUCTION_SITE_URL } from '@/lib/site-url'

export const SITE_NAME = 'sonicdesk.'
export const SITE_SHORT_NAME = 'sonicdesk'

export const SEO_DEFAULT_TITLE =
  'sonicdesk. — Version control for music bands'

export const SEO_DEFAULT_DESCRIPTION =
  'sonicdesk.studio is the collaborative workspace for bands and studios. Branch demos, merge arrangements, structure songs, chat in context, and rehearse together — git-like versioning built for musicians.'

export const OPEN_GRAPH_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: SEO_DEFAULT_TITLE,
  type: 'image/png',
} as const

export const SEO_KEYWORDS = [
  'music collaboration',
  'band workflow',
  'music version control',
  'demo versioning',
  'collaborative DAW',
  'music production tool',
  'band project management',
  'audio branching',
  'music rehearsal tool',
  'studio collaboration',
]

export function getMetadataBase(): URL {
  return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_SITE_URL)
}

export function getCanonicalUrl(path = '/'): string {
  const base = getMetadataBase()
  return new URL(path, base).toString()
}

const sharedOpenGraph = {
  siteName: SITE_NAME,
  locale: 'en_US',
  type: 'website' as const,
}

const sharedTwitter = {
  card: 'summary_large_image' as const,
  title: SEO_DEFAULT_TITLE,
  description: SEO_DEFAULT_DESCRIPTION,
}

/** Default metadata for the root layout (inherited by all pages). */
export function buildRootMetadata(): Metadata {
  return {
    metadataBase: getMetadataBase(),
    title: {
      default: SEO_DEFAULT_TITLE,
      template: `%s · ${SITE_NAME}`,
    },
    description: SEO_DEFAULT_DESCRIPTION,
    keywords: SEO_KEYWORDS,
    applicationName: SITE_SHORT_NAME,
    authors: [{ name: SITE_NAME, url: getCanonicalUrl() }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    category: 'music',
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      ...sharedOpenGraph,
      title: SEO_DEFAULT_TITLE,
      description: SEO_DEFAULT_DESCRIPTION,
      url: getCanonicalUrl(),
      images: [OPEN_GRAPH_IMAGE],
    },
    twitter: {
      ...sharedTwitter,
      images: [OPEN_GRAPH_IMAGE.url],
    },
    alternates: {
      canonical: getCanonicalUrl(),
    },
    icons: {
      icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
      shortcut: ['/icon.svg'],
    },
  }
}

/** Homepage-specific metadata (overrides root defaults where needed). */
export const homeMetadata: Metadata = {
  title: SEO_DEFAULT_TITLE,
  description: SEO_DEFAULT_DESCRIPTION,
  alternates: {
    canonical: getCanonicalUrl('/'),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    ...sharedOpenGraph,
    title: SEO_DEFAULT_TITLE,
    description: SEO_DEFAULT_DESCRIPTION,
    url: getCanonicalUrl('/'),
    images: [OPEN_GRAPH_IMAGE],
  },
  twitter: {
    ...sharedTwitter,
    images: [OPEN_GRAPH_IMAGE.url],
  },
}

/** Metadata for authenticated / utility routes that should not be indexed. */
export function noIndexMetadata(title: string, description?: string): Metadata {
  return {
    title,
    ...(description ? { description } : {}),
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    },
  }
}

type JsonLd = Record<string, unknown>

export function buildHomeJsonLd(): JsonLd[] {
  const url = getCanonicalUrl('/')

  const website: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: SITE_SHORT_NAME,
    url,
    description: SEO_DEFAULT_DESCRIPTION,
    inLanguage: 'en-US',
  }

  const organization: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url,
    logo: getCanonicalUrl('/icon.svg'),
    description: SEO_DEFAULT_DESCRIPTION,
  }

  const software: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url,
    description: SEO_DEFAULT_DESCRIPTION,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free during private beta',
    },
    featureList: [
      'Git-like branching for music demos',
      'In-browser mixer and rehearsal view',
      'Song structure and chord tools',
      'Band chat in project context',
      'Collaborative roadmap and decisions',
    ],
  }

  return [website, organization, software]
}

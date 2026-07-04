import type { Metadata } from 'next'
import { getSeoOrigin } from '@/lib/site-url'

export const SITE_NAME = 'sonicdesk.'
export const SITE_SHORT_NAME = 'sonicdesk'

export const SEO_DEFAULT_TITLE =
  'sonicdesk. — Version control for music bands'

export const SEO_DEFAULT_DESCRIPTION =
  'sonicdesk.studio is the band workspace for music version control. Branch and merge takes, drop comments on bars, auto-detect chords, chat with the band, and rehearse from your phone.'

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
  'band workspace',
  'music version control',
  'version control for music',
  'demo versioning',
  'collaborative DAW',
  'music production tool',
  'band project management',
  'audio branching',
  'music rehearsal tool',
  'rehearsal mode app',
  'studio collaboration',
  'comments on bars',
  'timestamped track comments',
  'chord detection',
  'automatic chord detection',
  'band chat app',
  'checklist with assignments',
  'roadmap tool for bands',
  'mobile mixer',
  'song structure editor',
]

/**
 * Plain-language, one-line-per-feature summary used in the homepage's
 * screen-reader/crawler content block. Keep this in sync with the feature
 * groups rendered in FeatureIndex (components/LandingPage.tsx) — it exists
 * so every target keyword phrase (version control, comments on bars, chord
 * detection, band chat, etc.) appears as real, accurate on-page text even
 * though the visible design expresses them stylistically.
 */
export const SEO_FEATURE_SUMMARY = [
  'Version control for music — branch, merge, and compare versions of a track without losing the original mix.',
  'Comments on bars — drop timestamped feedback anchored to an exact bar or time range.',
  'Song structure editor — mark intro, verse, chorus, bridge, and breakdown sections.',
  'Chord detection — automatic chord-per-section detection plus a chord chart for rehearsal.',
  'Mobile mixer — mix, mute, solo, and record tracks from a phone.',
  'Rehearsal mode — chords, structure, and loop sections built for the practice room.',
  'Band chat — project and band-wide chat with @mentions, version links, and track references.',
  'Roadmap — custom stages so the whole band can see what stage a song is at.',
  'Checklist with assignments — task lists assigned to specific band members.',
  'Band workspace — bands, invite codes, custom role tags, and a shared activity feed.',
]

/**
 * Visible FAQ content — rendered as a real, on-page FAQ section (see FAQ in
 * components/LandingPage.tsx) and mirrored into FAQPage JSON-LD via
 * buildFaqJsonLd(). Google requires FAQ structured data to match visible
 * page content, so this is the single source of truth for both.
 */
export const SEO_FAQS: { question: string; answer: string }[] = [
  {
    question: 'What is version control for music?',
    answer:
      "It's the same idea as Git, applied to a track instead of code: every take, mix, or arrangement change is saved as a real version with a date and author, so you can branch off to try something and merge it back — or roll back — without overwriting the original.",
  },
  {
    question: 'Can I leave a comment on a specific bar or timestamp in a track?',
    answer:
      'Yes. Comments on bars let you drop timestamped feedback anchored to an exact bar or time range on the waveform, so the whole band knows exactly which second or section a note refers to — no more "the part around 1:40-ish."',
  },
  {
    question: 'Does sonicdesk detect chords automatically?',
    answer:
      'Yes — automatic chord detection runs per section and builds a chord chart you can use for rehearsal, on top of the song structure editor (intro, verse, chorus, bridge, breakdown).',
  },
  {
    question: 'Is there a mobile mixer or rehearsal mode app?',
    answer:
      'Yes. The mobile mixer lets you mix, mute, solo, and record tracks from a phone, and rehearsal mode surfaces chords, structure, and loopable sections built for the practice room — no laptop or DAW required.',
  },
  {
    question: 'How is sonicdesk different from other music collaboration tools?',
    answer:
      'sonicdesk is a band workspace built around version control first: branching, merging, and comparing takes, plus comments on bars, chord detection, a roadmap with checklists, and band chat, all in one place — rather than a general-purpose DAW or file-storage tool with collaboration bolted on.',
  },
  {
    question: 'Is sonicdesk free?',
    answer: 'Yes — sonicdesk is free to use during private beta, with every workspace including branches, the mixer, structure, chords, chat, and rehearsal view from day one.',
  },
]

export function getMetadataBase(): URL {
  return new URL(getSeoOrigin())
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

/**
 * Metadata for the marketing "slice" pages (/features/*, /audience/*).
 * Inherits the root title template (`%s · sonicdesk.`) and robots defaults.
 */
export function buildSlicePageMetadata({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): Metadata {
  return {
    title,
    description,
    alternates: {
      canonical: getCanonicalUrl(path),
    },
    openGraph: {
      ...sharedOpenGraph,
      type: 'article',
      title: `${title} · ${SITE_NAME}`,
      description,
      url: getCanonicalUrl(path),
      images: [OPEN_GRAPH_IMAGE],
    },
    twitter: {
      ...sharedTwitter,
      title: `${title} · ${SITE_NAME}`,
      description,
      images: [OPEN_GRAPH_IMAGE.url],
    },
  }
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

/**
 * JSON-LD for marketing slice pages (/features/*, /audience/*, /vs/*):
 * a BreadcrumbList (Home → page) plus a WebPage node tied to the site.
 * Helps Google understand the page hierarchy now that the site is no
 * longer a single indexable URL.
 */
export function buildSlicePageJsonLd({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}): JsonLd[] {
  const url = getCanonicalUrl(path)

  const breadcrumbs: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: SITE_NAME,
        item: getCanonicalUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: title,
        item: url,
      },
    ],
  }

  const webPage: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${title} · ${SITE_NAME}`,
    url,
    description,
    inLanguage: 'en-US',
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: getCanonicalUrl('/'),
    },
  }

  return [breadcrumbs, webPage]
}

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
      'Version control for music — branching, merging, and version comparison',
      'Comments on bars — timestamped feedback anchored to a bar or time range',
      'Song structure editor with automatic chord detection',
      'Mobile mixer and rehearsal mode',
      'Band chat with @mentions, version links, and track references',
      'Roadmap stages and checklist with assignments',
      'Band workspace with invite codes and role tags',
    ],
  }

  // FAQPage JSON-LD is intentionally omitted while the visible FAQ section
  // in components/LandingPage.tsx is hidden — Google requires FAQ structured
  // data to match visible page content. Re-add this alongside re-enabling
  // that section (SEO_FAQS below already has the content ready):
  //
  // const faq: JsonLd = {
  //   '@context': 'https://schema.org',
  //   '@type': 'FAQPage',
  //   mainEntity: SEO_FAQS.map(({ question, answer }) => ({
  //     '@type': 'Question',
  //     name: question,
  //     acceptedAnswer: { '@type': 'Answer', text: answer },
  //   })),
  // }

  return [website, organization, software]
}

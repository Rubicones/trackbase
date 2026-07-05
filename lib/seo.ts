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
  'free chord detector',
  'find chords of a song',
  'chord finder',
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
 * buildHomeJsonLd(). Google requires FAQ structured data to match visible
 * page content, so this is the single source of truth for both. `tag` drives
 * the on-page filter chips — keep it one of FAQ_TAGS in LandingPage.tsx.
 */
export const SEO_FAQS: { tag: string; question: string; answer: string }[] = [
  {
    tag: 'basics',
    question: 'wait — is this a DAW?',
    answer:
      "no. sonicdesk isn't where you make the sound — it's where the sound lives. a workspace and collaboration room that sits around your DAW: versions, comments, structure, chords, chat, resources. bring the bounce, we handle everything else.",
  },
  {
    tag: 'solo',
    question: "i'm a solo musician. does sonicdesk still make sense?",
    answer:
      "absolutely. keep demos, sheets, references and voice memos in one place. leave notes for future-you when the idea is still hot. and when a producer, mix engineer or label finally joins in — you invite them into the same room, nothing to migrate.",
  },
  {
    tag: 'pricing',
    question: 'is it free?',
    answer:
      'yes — the free plan covers 1 band, up to 3 members and 1 GB of storage. plenty for a first project or a small duo. paid plans lift the limits when your world gets bigger.',
  },
  {
    tag: 'pricing',
    question: 'on a paid plan, does every band member pay?',
    answer:
      'no — only one person pays. they open the band, upgrade it, then invite everyone else into a room that already has the bigger limits. bandmates never see a paywall.',
  },
  {
    tag: 'versioning',
    question: 'what happens if two versions overlap or conflict?',
    answer:
      "if we can merge them cleanly, we do it silently. if we can't — say two people rewrote the same bar — we stop and ask you: side-by-side diff, you pick what stays and what goes. nothing gets overwritten behind your back.",
  },
  {
    tag: 'versioning',
    question: 'how many versions can i create per project?',
    answer:
      "as many as you want. seriously — unlimited. branch a chorus, branch the branch, keep the weird one from tuesday night. storage counts against the plan, version count doesn't.",
  },
  {
    tag: 'files',
    question: 'what file formats can i upload?',
    answer:
      'WAV, MP3 and MIDI today. more coming — stems, project files, notation formats — as we polish each one.',
  },
  {
    tag: 'files',
    question: 'do you compress my audio?',
    answer:
      'no. everything is transcoded to FLAC and kept lossless. the sound you upload is the sound we store — nothing lost, nothing "optimised" behind your back.',
  },
  {
    tag: 'files',
    question: 'can i download my files in original quality?',
    answer:
      'yes. the file you download is byte-for-byte the file you uploaded. no re-encodes, no watermarks, no surprises.',
  },
  {
    tag: 'versioning',
    question: "what's versioning and how does it actually work?",
    answer:
      "every project starts with one Master. want to try a wilder chorus or a slower bridge? spin up a new version — it's a full copy of Master, safe to break. Master stays untouched. when the new take clearly wins, apply it back into Master. experiment freely, never lose the good one.",
  },
  {
    tag: 'security',
    question: 'is it safe to upload my unreleased demos?',
    answer:
      'we treat unreleased music like the fragile thing it is. tracks are private by default — only your bandmates can play or download them. no public URLs, no discovery, no leaks.',
  },
  {
    tag: 'mobile',
    question: 'is there a mobile app?',
    answer:
      'the web app installs to your phone as a PWA today — full mixer and rehearsal mode included. a native Android app lands with the public launch, iOS follows later this year.',
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

  // Google requires FAQPage structured data to match visible page content —
  // SEO_FAQS above is the single source of truth for both the JSON-LD here
  // and the visible FAQ section rendered in components/LandingPage.tsx.
  const faq: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: SEO_FAQS.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }

  return [website, organization, software, faq]
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { TopBar } from '@/components/LandingPage'
import { ScopeBanner } from '@/components/landing/SliceChrome'
import { ChordDetectorTool } from '@/components/tools/ChordDetectorTool'
import { JsonLd } from '@/components/seo/JsonLd'
import {
  CHORD_DETECTOR_FAQS,
  buildChordDetectorJsonLd,
  getCanonicalUrl,
  getMetadataBase,
  OPEN_GRAPH_IMAGE,
} from '@/lib/seo'

const TITLE = 'Free Chord Detector — Identify Chords in Any Song'
const DESCRIPTION =
  'Upload an audio file and instantly detect the chords and key of any song. Free, no sign-up required. Works best with piano, guitar, and harmonic instruments.'
const PATH = '/tools/chord-detector'

const KEYWORDS = [
  'chord detector',
  'chord detector free',
  'free chord detector',
  'chord recognition tool',
  'detect chords from audio',
  'find the chords of a song',
  'song key finder',
  'chord finder online',
  'guitar chord finder',
  'piano chord finder',
  'automatic chord detection',
  'chords and key detector',
]

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: KEYWORDS,
  alternates: {
    canonical: getCanonicalUrl(PATH),
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
    siteName: 'sonicdesk.',
    locale: 'en_US',
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: getCanonicalUrl(PATH),
    images: [OPEN_GRAPH_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OPEN_GRAPH_IMAGE.url],
  },
}

/**
 * Standalone public tool page — no auth, no app shell (see middleware.ts
 * PUBLIC_PREFIXES). All SEO-critical copy (H1, intro, instructions, FAQ)
 * is rendered here as a real server component so it's in the initial HTML
 * with no client JS required — only the upload/results widget below is
 * interactive ('use client', in ChordDetectorTool).
 */
export const dynamic = 'force-static'

const borderMuted = 'border-[color-mix(in_oklab,var(--border)_80%,transparent)]'

export default function ChordDetectorPage() {
  return (
    <div className="landing-page min-h-screen" data-theme="lime">
      <JsonLd data={buildChordDetectorJsonLd()} />

      <div className="mx-auto w-full max-w-[1920px]">
        {/* Same header as the main landing page */}
        <TopBar />

        {/* Obvious, persistent redirect back to the full product */}
        <ScopeBanner kind="feature">Here&rsquo;s a taste of it.</ScopeBanner>

        <main className="mx-auto min-h-screen max-w-[680px] bg-background px-5 py-12 text-foreground sm:py-16">
          <header className="animate-slide-in mb-8">
            <h1 className="font-display-tb text-2xl font-bold tracking-tight sm:text-3xl">Free Chord Detector</h1>
            <p className="font-mono-tb mt-2 text-[11px] leading-relaxed text-muted-foreground">
              A free chord detector that finds the chords and key of any song. Upload a track and get a
              chord-by-chord timeline back — with timestamps and bar numbers — in seconds. No sign-up, no
              credit card, works right in your browser.
            </p>
          </header>

          {/* Instruction card */}
          <section
            className={`animate-slide-in mb-8 border ${borderMuted} bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4 sm:p-5`}
            style={{ animationDelay: '0.05s' }}
          >
            <p className="font-mono-tb mb-2.5 text-[10px] uppercase tracking-[0.18em] text-lime">For best results</p>
            <ul className="space-y-1.5">
              {[
                'Upload a file with harmonic content — piano, guitar, keys, or pads work best',
                'Avoid files with only melody (single-note lines) — chords need multiple notes played simultaneously',
                'Heavy drums and bass can reduce accuracy — try a stems-only version if you have one',
                'Shorter clips (30–90 seconds) analyze faster and more accurately than full songs',
              ].map(tip => (
                <li key={tip} className="font-mono-tb flex gap-2 text-[11px] leading-snug text-muted-foreground">
                  <span className="text-lime">·</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Interactive widget — upload, BPM, processing, results, play-along */}
          <ChordDetectorTool />

          {/* FAQ — visible content mirrored into FAQPage JSON-LD (buildChordDetectorJsonLd) */}
          <section className="animate-slide-in mt-12" style={{ animationDelay: '0.1s' }}>
            <h2 className="font-display-tb text-lg font-bold tracking-tight">Chord detector FAQ</h2>
            <div className="mt-4">
              {CHORD_DETECTOR_FAQS.map(faq => (
                <div key={faq.question} className={`border-t ${borderMuted} py-3.5 first:border-t-0 first:pt-0`}>
                  <h3 className="font-mono-tb text-[12px] font-bold uppercase tracking-[0.06em] text-foreground">
                    {faq.question}
                  </h3>
                  <p className="font-mono-tb mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Conversion nudge */}
          <div
            className={`animate-slide-in mt-10 border ${borderMuted} bg-[color-mix(in_oklab,var(--card)_25%,transparent)] p-5 text-center`}
            style={{ animationDelay: '0.15s' }}
          >
            <p className="font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
              Want to attach chord charts to your tracks, collaborate with your band, and version your demos?
            </p>
            <Link href="/" className="tb-btn-accent mt-3 inline-flex items-center bg-lime px-5 py-2.5 text-[11px] uppercase">
              Try sonicdesk →
            </Link>
          </div>
        </main>
      </div>
    </div>
  )
}

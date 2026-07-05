import ChordDetectorPage from '@/components/landing/ChordDetectorPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'Free Chord Detector — Find the Chords of Any Song',
  description:
    'Free online chord detector. Upload an audio file, confirm the tempo and time signature, and get a chord-by-chord timeline with timestamps, bar numbers, and key — no sign-up.',
  path: '/tools/chord-detector',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <ChordDetectorPage />
    </>
  )
}

import MobileFeaturePage from '@/components/landing/MobileFeaturePage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'Mobile mixer & rehearsal mode app for bands',
  description:
    'Your phone is the studio. Rehearsal mode with giant chords, structure and section loops; a full mobile mixer with mute, solo and mic recording. No laptop, no DAW needed.',
  path: '/features/mobile',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <MobileFeaturePage />
    </>
  )
}

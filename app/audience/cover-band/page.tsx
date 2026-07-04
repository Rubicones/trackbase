import CoverBandPage from '@/components/landing/CoverBandPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'For cover bands — shared chord charts & rehearsal app',
  description:
    'One chord chart everyone plays from. Structure and chords over the timeline, resources attached, rehearse from any phone.',
  path: '/audience/cover-band',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <CoverBandPage />
    </>
  )
}

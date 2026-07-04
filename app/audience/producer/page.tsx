import ProducerPage from '@/components/landing/ProducerPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'For producers & collaborators — versioned track sharing',
  description:
    'No more _final_v3_FINAL.wav. A shared context for producers and vocalists — versioned, commented, single source of truth.',
  path: '/audience/producer',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <ProducerPage />
    </>
  )
}

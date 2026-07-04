import IndieBandPage from '@/components/landing/IndieBandPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'For indie bands — one workspace for demos & decisions',
  description:
    "Files get lost, versions blur, feedback lives in voice notes. sonicdesk brings your band's work into one place — versioned, commented, playable.",
  path: '/audience/indie-band',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <IndieBandPage />
    </>
  )
}

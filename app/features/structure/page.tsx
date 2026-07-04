import StructureFeaturePage from '@/components/landing/StructureFeaturePage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'Song structure editor & automatic chord detection',
  description:
    'Map your song — verse, chorus, bridge — with automatic chord detection under every section. Loop any part for practice and get a chord chart for rehearsal. One source of truth for the whole band.',
  path: '/features/structure',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <StructureFeaturePage />
    </>
  )
}

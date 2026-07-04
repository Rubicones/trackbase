import VersionsFeaturePage from '@/components/landing/VersionsFeaturePage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'Version control for music — branch, merge & A/B compare',
  description:
    'Branch a mix like code, compare two versions face-to-face, and apply the winning take back to master with a visible diff. Git-style version control built for music bands.',
  path: '/features/versions',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <VersionsFeaturePage />
    </>
  )
}

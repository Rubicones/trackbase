import CommentsFeaturePage from '@/components/landing/CommentsFeaturePage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildSlicePageMetadata, buildSlicePageJsonLd } from '@/lib/seo'

const seo = {
  title: 'Comments on bars — timestamped track comments',
  description:
    'Drop feedback on the exact bar, not "around 1:40". Range comments with threads, @mentions, resolve & pin — anchored to the music and the version it belongs to.',
  path: '/features/comments',
}

export const metadata = buildSlicePageMetadata(seo)

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Page() {
  return (
    <>
      <JsonLd data={buildSlicePageJsonLd(seo)} />
      <CommentsFeaturePage />
    </>
  )
}

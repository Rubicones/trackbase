import LandingPage from '@/components/LandingPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildHomeJsonLd, homeMetadata, SEO_DEFAULT_DESCRIPTION } from '@/lib/seo'

export const metadata = homeMetadata

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

export default function Home() {
  return (
    <>
      <JsonLd data={buildHomeJsonLd()} />
      <div className="sr-only">
        <h1>sonicdesk.</h1>
        <p>{SEO_DEFAULT_DESCRIPTION}</p>
      </div>
      <LandingPage />
    </>
  )
}

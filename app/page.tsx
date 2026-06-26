import LandingPage from '@/components/LandingPage'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildHomeJsonLd, homeMetadata } from '@/lib/seo'

export const metadata = homeMetadata

export default function Home() {
  return (
    <>
      <JsonLd data={buildHomeJsonLd()} />
      <LandingPage />
    </>
  )
}

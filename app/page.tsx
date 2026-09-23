import LandingPage from '@/components/LandingPage'
import { getPriceCatalog } from '@/lib/billing/catalog'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildHomeJsonLd, homeMetadata, SEO_DEFAULT_DESCRIPTION, SEO_FEATURE_SUMMARY } from '@/lib/seo'

export const metadata = homeMetadata

/** Static marketing page — full HTML for crawlers without auth cookies. */
export const dynamic = 'force-static'

/**
 * Re-rendered at most hourly so the pricing section follows Stripe. The
 * prices are read on the server (`lib/billing/catalog.ts`) at build and on
 * each revalidation; a Price changed in Stripe means a new Price id in env,
 * i.e. a deploy, which rebuilds this anyway — the hour is a safety net.
 */
export const revalidate = 3600

// buildHomeJsonLd() includes FAQPage schema mirroring the visible FAQ section
// in LandingPage.tsx (see lib/seo.ts#SEO_FAQS) — kept in sync there.

export default async function Home() {
  const prices = await getPriceCatalog()

  return (
    <>
      <JsonLd data={buildHomeJsonLd()} />
      {/*
        Visually hidden, but real crawlable content (not the page's H1 — that lives in
        the visible hero heading below). Screen readers get an accurate feature summary
        for a highly animated/visual page; search engines get the plain-language names
        for each feature alongside the stylized on-page copy.
      */}
      <div className="sr-only">
        <p>{SEO_DEFAULT_DESCRIPTION}</p>
        <h2>Features</h2>
        <ul>
          {SEO_FEATURE_SUMMARY.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </div>
      <LandingPage prices={prices} />
    </>
  )
}

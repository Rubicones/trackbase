import SimpleLandingPage from '@/components/landing/SimpleLandingPage'
import { getPriceCatalog } from '@/lib/billing/catalog'
import { JsonLd } from '@/components/seo/JsonLd'
import {
  buildHomeJsonLd,
  simpleLandingMetadata,
  SEO_DEFAULT_DESCRIPTION,
  SEO_FEATURE_SUMMARY,
} from '@/lib/seo'

export const metadata = simpleLandingMetadata

/**
 * The `simple` arm of the landing A/B test.
 *
 * Reachable two ways, both intended (see `lib/landingVariant.ts`):
 *   * `middleware.ts` rewrites `/` here for visitors assigned to `simple` — the
 *     URL in the address bar stays `/`;
 *   * directly, via a shared `/simple` link, which pins the visitor to this
 *     variant for subsequent visits rather than re-rolling them into control.
 *
 * force-static for the same reason as `/`: full HTML for crawlers with no auth
 * cookies, and a prerendered document for the middleware rewrite to serve.
 */
export const dynamic = 'force-static'

/**
 * Re-rendered at most hourly, for the same reason as `/`: this variant now has
 * a pricing section, and a force-static page with no revalidation would serve
 * whatever the prices were at build time forever.
 */
export const revalidate = 3600

export default async function SimpleLanding() {
  const prices = await getPriceCatalog()

  return (
    <>
      <JsonLd data={buildHomeJsonLd()} />
      {/*
        Visually hidden, but real crawlable content — mirrors the control landing
        page. The simplified variant strips prose from the visible sections, so
        this summary is the plain-language feature list search engines and screen
        readers get for an otherwise heavily visual page.
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
      <SimpleLandingPage prices={prices} />
    </>
  )
}

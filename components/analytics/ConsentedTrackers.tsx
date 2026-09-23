'use client'

import { GoogleAnalytics } from '@next/third-parties/google'
import { useConsent } from '@/components/consent/ConsentProvider'
import { MetaPixel } from './MetaPixel'
import { YandexMetrica } from './YandexMetrica'

const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

/**
 * GA4, Meta Pixel and Yandex Metrica — rendered ONLY with stored consent.
 *
 * Without it this returns null, so no script tag, inline snippet or request
 * for any of the three reaches the page (not "loaded but suppressed").
 * - Consent already stored + a dynamic route: the server saw the cookie and
 *   these render in the initial HTML.
 * - Consent already stored + a force-static page (landing, /features/*, …):
 *   the prerendered HTML is tracker-free for everyone; they mount right after
 *   hydration once ConsentProvider has read the cookie.
 * - Accept clicked: they mount immediately, and each fires its own initial
 *   page view for the current page.
 * - Consent withdrawn: they unmount, which stops the SPA route-change hits;
 *   the scripts already executed stay in memory for this page view (see
 *   setVendorOptOut in ConsentProvider) and are not rendered on the next load.
 */
export function ConsentedTrackers() {
  const { consent } = useConsent()
  if (consent?.choice !== 'accepted') return null

  return (
    <>
      {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      <MetaPixel />
      <YandexMetrica />
    </>
  )
}

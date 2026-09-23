'use client'

import { useEffect, useRef } from 'react'
import { trackEvent } from '@/lib/analytics'
import type { LandingVariant } from '@/lib/landingVariant'

/**
 * Fires `landing_variant_viewed` once per mount, on whichever landing variant
 * rendered it.
 *
 * This is an *additional* event, not a `page_view` override — GA4 page views
 * still come from `<GoogleAnalytics />` (initial load) and `PageViewTracker`
 * (SPA route changes), both untouched. Reporting on the experiment reads this
 * event's `variant` parameter.
 *
 * The variant is passed in by the page that renders it rather than read from
 * the cookie: each landing component only ever renders as one variant, so the
 * value is known statically and cannot race the cookie being written by
 * middleware on this very response.
 */
export function LandingVariantEvent({ variant }: { variant: LandingVariant }) {
  // Guards against the double-invoked effect in React StrictMode (dev), which
  // would otherwise report two views for every one impression.
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true
    trackEvent('landing_variant_viewed', { variant })
  }, [variant])

  return null
}

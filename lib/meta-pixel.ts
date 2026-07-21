/**
 * Meta (Facebook) Pixel helper.
 *
 * The pixel is loaded once, globally, by <MetaPixel /> in the root layout.
 * This module is the single place to fire events from anywhere in the app.
 *
 * Adding a conversion event later is a one-liner at the call site, e.g.:
 *   import { trackMetaEvent } from '@/lib/meta-pixel'
 *   trackMetaEvent('CompleteRegistration')
 *   trackMetaEvent('Subscribe', { value: 9.99, currency: 'USD' })
 *   trackMetaCustom('StartedRecording', { trackId })
 *
 * All calls are no-ops when the pixel isn't loaded (missing env var, SSR,
 * blocked script), so call sites never need to guard.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
  }
}

/** Pixel ID from Vercel env. Undefined => pixel disabled, everything no-ops. */
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

export function isMetaPixelEnabled(): boolean {
  return Boolean(META_PIXEL_ID)
}

function fbqReady(): boolean {
  return typeof window !== 'undefined' && typeof window.fbq === 'function'
}

/** Fire a Meta *standard* event (PageView, Lead, CompleteRegistration, Subscribe, Purchase, ...). */
export function trackMetaEvent(
  event: string,
  params?: Record<string, unknown>,
): void {
  if (!fbqReady()) return
  if (params) window.fbq!('track', event, params)
  else window.fbq!('track', event)
}

/** Fire a fully *custom* event (any name you choose). */
export function trackMetaCustom(
  event: string,
  params?: Record<string, unknown>,
): void {
  if (!fbqReady()) return
  if (params) window.fbq!('trackCustom', event, params)
  else window.fbq!('trackCustom', event)
}

/** Convenience wrapper for the SPA route-change PageView. */
export function trackMetaPageView(): void {
  trackMetaEvent('PageView')
}

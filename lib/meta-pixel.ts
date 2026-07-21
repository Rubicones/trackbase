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

/**
 * GA4 event name -> Meta *standard* event.
 *
 * Every GA4 event is mirrored to the pixel under its own name as a custom
 * event (see mirrorToMetaPixel). For the conversions below we ALSO fire the
 * matching Meta standard event, because standard events get first-class
 * treatment: they populate the Conversions column, feed Advantage+ campaigns,
 * and unlock pre-built optimization goals. Firing both the custom and the
 * standard event is Meta's recommended pattern (granular analysis + ad
 * optimization) — a custom event should supplement, never replace, a standard.
 *
 * Mapping rationale (best-practice: closest standard event, mapped across the
 * funnel, no faked revenue):
 *   - Onboarding completion is the clean "new user finished signup" moment
 *     (only new users pass through onboarding) -> CompleteRegistration.
 *   - Viewing a paywall plan and clicking subscribe are the mid-funnel steps
 *     Meta wants -> ViewContent -> InitiateCheckout.
 *   - Waitlist confirmation is the strongest purchase-intent signal we have.
 *     This is a WAITLIST product with no real payment, so it maps to Lead —
 *     NOT Subscribe/Purchase, which would pollute conversion/ROAS data.
 *   - Feedback submission is a customer-to-business contact -> Contact.
 *
 * Deliberately NOT mapped:
 *   - magic_link_sent / sign_in_clicked: the auth page is shared by new
 *     signups AND returning logins, so mapping to Lead/CompleteRegistration
 *     would inflate those conversions with existing users signing in.
 *
 * Edit this map freely as conversion semantics change — it's the only place
 * that needs touching. Standard event names must be exact, case-sensitive
 * Meta events: https://developers.facebook.com/docs/meta-pixel/reference#standard-events
 */
const STANDARD_EVENT_MAP: Record<string, string> = {
  onboarding_username_set: 'CompleteRegistration',
  paywall_plan_viewed: 'ViewContent',
  paywall_subscribe_clicked: 'InitiateCheckout',
  paywall_waitlist_confirmed: 'Lead',
  feedback_submitted: 'Contact',
}

/**
 * Mirror a GA4 analytics event into the Meta Pixel. Called once, centrally,
 * from trackEvent() in lib/analytics.ts — so every existing and future GA4
 * event is duplicated to the pixel with no per-call-site work.
 *
 * - `page_view` is skipped: the SPA PageView is already owned by the
 *   route-change tracker in <MetaPixel />, so mirroring it would double-count.
 * - Everything else fires as a same-named custom event.
 * - Conversions in STANDARD_EVENT_MAP additionally fire a Meta standard event.
 */
export function mirrorToMetaPixel(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (eventName === 'page_view') return

  trackMetaCustom(eventName, params)

  const standardEvent = STANDARD_EVENT_MAP[eventName]
  if (standardEvent) trackMetaEvent(standardEvent, params)
}

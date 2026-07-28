import { mirrorToMetaPixel } from './meta-pixel'
import { mirrorToYandexMetrica, setYandexUserParams } from './yandex-metrica'

export type AnalyticsParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    gtag?: (
      command: 'event' | 'config' | 'js' | 'set',
      targetId: string,
      params?: Record<string, unknown>,
    ) => void
  }
}

/**
 * Attach GA4 *user properties* — attributes of the person rather than of one
 * action, applied to every event they send afterwards in the session. This is
 * what lets a report split any existing event by cohort without adding a cohort
 * parameter to all ~80 of them.
 *
 * Mirrored to Yandex Metrica as `userParams`, its direct counterpart (sticky
 * visitor attributes, usable as a report segment). Not mirrored to the Meta
 * Pixel: the pixel has no equivalent concept, and `trackEvent` is the only
 * path to it by design.
 *
 * Keep these non-identifying, same as event params — no email, no user id.
 */
export function setUserProperties(properties: AnalyticsParams) {
  if (typeof window === 'undefined') return
  window.gtag?.('set', 'user_properties', properties)
  setYandexUserParams(properties)
}

export function trackEvent(eventName: string, params?: AnalyticsParams) {
  if (typeof window === 'undefined') return

  const enriched = { ...params, app_version: '0.9' }

  // Google Analytics 4
  if (window.gtag) {
    window.gtag('event', eventName, enriched)
  }

  // Meta Pixel — mirror of the same event (no-op if the pixel isn't loaded).
  // Guarded independently of gtag so the pixel fires even when GA is absent.
  mirrorToMetaPixel(eventName, enriched)

  // Yandex Metrica — same event as a goal under the identical name (no-op if
  // the counter isn't loaded). Also guarded independently of gtag.
  mirrorToYandexMetrica(eventName, enriched)
}

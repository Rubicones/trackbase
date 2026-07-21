import { mirrorToMetaPixel } from './meta-pixel'

export type AnalyticsParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    gtag?: (
      command: 'event' | 'config' | 'js',
      targetId: string,
      params?: Record<string, unknown>,
    ) => void
  }
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
}

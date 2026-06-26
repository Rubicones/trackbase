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
  if (!window.gtag) return

  window.gtag('event', eventName, {
    ...params,
    app_version: '0.9',
  })
}

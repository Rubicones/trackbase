/**
 * Yandex Metrica helper.
 *
 * The counter is loaded once, globally, by <YandexMetrica /> in the root
 * layout. This module is the single place to talk to it from anywhere in the
 * app — mirroring the shape of `lib/meta-pixel.ts`.
 *
 * Every GA4 event fired through `trackEvent()` (lib/analytics.ts) is mirrored
 * here as a Metrica **goal** (`reachGoal`) under the exact same snake_case
 * name, so the two systems stay in lockstep with no per-call-site work. GA4
 * event names are already `[a-z0-9_]` only, which is exactly what Metrica
 * accepts as a goal identifier — no name translation is needed or wanted.
 *
 * A goal only shows up in Metrica reports after it is also created in the
 * counter UI (Settings -> Goals -> JavaScript event, "Identifier" = the event
 * name). Events fired before that are simply ignored server-side; nothing
 * breaks, so there is no need to keep an allow-list in code.
 *
 * All calls are no-ops when the counter isn't loaded (missing env var, SSR,
 * blocked script, ad blocker), so call sites never need to guard.
 */

declare global {
  interface Window {
    ym?: (counterId: number, action: string, ...args: unknown[]) => void
  }
}

/**
 * Counter ID from Vercel env. Undefined/unparseable => counter disabled and
 * everything below no-ops, which is what keeps local dev and preview deploys
 * out of production statistics.
 */
export const YANDEX_METRICA_ID = (() => {
  const raw = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID
  if (!raw) return undefined
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : undefined
})()

export function isYandexMetricaEnabled(): boolean {
  return YANDEX_METRICA_ID !== undefined
}

function ymReady(): YMCall | null {
  if (YANDEX_METRICA_ID === undefined) return null
  if (typeof window === 'undefined') return null
  if (typeof window.ym !== 'function') return null
  return window.ym as YMCall
}

type YMCall = (counterId: number, action: string, ...args: unknown[]) => void

/** Fire a Metrica goal (their equivalent of a GA4 conversion event). */
export function trackYandexGoal(
  goal: string,
  params?: Record<string, unknown>,
): void {
  const ym = ymReady()
  if (!ym) return
  if (params) ym(YANDEX_METRICA_ID!, 'reachGoal', goal, params)
  else ym(YANDEX_METRICA_ID!, 'reachGoal', goal)
}

/**
 * Record a page view. The counter's `init` fires the first hit itself, so this
 * is only for App Router client-side navigations (see <YandexMetrica />).
 *
 * `referer` is passed explicitly because Metrica cannot infer it on an SPA
 * navigation — without it every in-app page looks like a direct entry.
 */
export function trackYandexPageView(url: string, referer?: string): void {
  const ym = ymReady()
  if (!ym) return
  ym(YANDEX_METRICA_ID!, 'hit', url, {
    title: typeof document !== 'undefined' ? document.title : undefined,
    ...(referer ? { referer } : {}),
  })
}

/**
 * Metrica's counterpart to GA4 user properties: attributes of the visitor,
 * sticky across their subsequent hits, usable as a report segment.
 * Keep these non-identifying — no email, no user id.
 */
export function setYandexUserParams(params: Record<string, unknown>): void {
  const ym = ymReady()
  if (!ym) return
  ym(YANDEX_METRICA_ID!, 'userParams', params)
}

/**
 * Mirror a GA4 analytics event into Metrica. Called once, centrally, from
 * `trackEvent()` in lib/analytics.ts — so every existing and future GA4 event
 * reaches Metrica automatically.
 *
 * `page_view` is skipped: page views are owned by the counter's own `init`
 * hit plus the route-change `hit` in <YandexMetrica />, so mirroring the GA4
 * event would double-count them. This matches `mirrorToMetaPixel`.
 */
export function mirrorToYandexMetrica(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (eventName === 'page_view') return
  trackYandexGoal(eventName, params)
}

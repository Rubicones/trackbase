'use client'

import Script from 'next/script'
import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { YANDEX_METRICA_ID, trackYandexPageView } from '@/lib/yandex-metrica'

/**
 * Yandex Metrica counter.
 *
 * - Loads Yandex's standard `tag.js` snippet once, globally, with strategy
 *   "afterInteractive" so it never blocks first paint. `init` fires the
 *   initial page-view hit on load.
 * - Fires an additional `hit` on every client-side route change (path or
 *   query-param change), since App Router SPA navigation doesn't reload —
 *   passing the previous URL as `referer`, which Metrica cannot infer itself
 *   on an SPA navigation.
 * - Skips the very first render so the initial load isn't double-counted.
 * - Renders nothing (and loads nothing) when the counter ID env var is absent,
 *   which is what keeps dev and preview deploys out of production stats.
 *
 * Enabled features (chosen deliberately, no session replay): `clickmap` for
 * the click heatmap, `trackLinks` for outbound-link clicks, and
 * `accurateTrackBounce` so a visitor who stays 15 s on one page isn't counted
 * as a bounce. Webvisor (session recording) is intentionally OFF — it records
 * user interaction in detail and would need a privacy-policy change first.
 */
export function YandexMetrica() {
  if (YANDEX_METRICA_ID === undefined) return null

  return (
    <>
      <Script id="yandex-metrica-base" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${YANDEX_METRICA_ID}, "init", {
  clickmap: true,
  trackLinks: true,
  accurateTrackBounce: true
});`}
      </Script>

      <noscript
        dangerouslySetInnerHTML={{
          __html: `<div><img src="https://mc.yandex.ru/watch/${YANDEX_METRICA_ID}" style="position:absolute; left:-9999px;" alt="" /></div>`,
        }}
      />

      {/* useSearchParams must live under a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <RouteChangeHit />
      </Suspense>
    </>
  )
}

/** Fires a Metrica hit on SPA navigations, skipping the initial load. */
function RouteChangeHit() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const skipInitialRef = useRef(true)
  const prevUrlRef = useRef<string | null>(null)

  const query = searchParams?.toString() ?? ''
  const key = query ? `${pathname}?${query}` : pathname

  useEffect(() => {
    const url = window.location.href

    if (skipInitialRef.current) {
      skipInitialRef.current = false
      prevUrlRef.current = url
      return
    }
    if (url === prevUrlRef.current) return

    const referer = prevUrlRef.current ?? undefined
    prevUrlRef.current = url
    trackYandexPageView(url, referer)
  }, [key])

  return null
}

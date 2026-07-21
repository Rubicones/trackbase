'use client'

import Script from 'next/script'
import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { META_PIXEL_ID, trackMetaPageView } from '@/lib/meta-pixel'

/**
 * Meta (Facebook) Pixel.
 *
 * - Loads Meta's standard base snippet once, globally, with strategy
 *   "afterInteractive" so it never blocks first paint. The snippet fires the
 *   initial PageView on load.
 * - Fires an additional PageView on every client-side route change (path or
 *   query-param change), since App Router SPA navigation doesn't reload.
 * - Skips the very first render so the initial load isn't double-counted.
 * - Renders nothing (and loads nothing) when the pixel ID env var is absent.
 */
export function MetaPixel() {
  if (!META_PIXEL_ID) return null

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>

      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>

      {/* useSearchParams must live under a Suspense boundary in the App Router. */}
      <Suspense fallback={null}>
        <RouteChangePageView />
      </Suspense>
    </>
  )
}

/** Fires a PageView on SPA navigations, skipping the initial load. */
function RouteChangePageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const skipInitialRef = useRef(true)
  const prevKeyRef = useRef<string | null>(null)

  const query = searchParams?.toString() ?? ''
  const key = query ? `${pathname}?${query}` : pathname

  useEffect(() => {
    if (skipInitialRef.current) {
      skipInitialRef.current = false
      prevKeyRef.current = key
      return
    }
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    trackMetaPageView()
  }, [key])

  return null
}

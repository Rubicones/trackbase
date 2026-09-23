import type { Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import { fontVariables } from '@/lib/fonts'
import { buildThemeBootstrapScript, DEFAULT_DESIGN_THEME } from '@/lib/design-theme-shared'
import { PALETTE_STORAGE_KEY } from '@/lib/palettes'
import { buildRootMetadata } from '@/lib/seo'
import { cookies } from 'next/headers'
import { Analytics } from "@vercel/analytics/next"
import { ConsentedTrackers } from '@/components/analytics/ConsentedTrackers'
import { ConsentProvider } from '@/components/consent/ConsentProvider'
import { CookieBanner } from '@/components/consent/CookieBanner'
import { CONSENT_COOKIE, parseConsent } from '@/lib/consent'

export const metadata = buildRootMetadata()
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070707' },
    { media: '(prefers-color-scheme: light)', color: '#070707' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // GDPR: GA4 / Meta Pixel / Yandex Metrica render only with stored consent
  // (see components/analytics/ConsentedTrackers.tsx). On force-static pages
  // this read is empty by design and the client resolves it after hydration.
  const initialConsent = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value)
  const paletteScript = `(function(){try{var p=localStorage.getItem('${PALETTE_STORAGE_KEY}');if(p&&p!=='default')document.documentElement.setAttribute('data-palette',p)}catch(e){}})()`

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={fontVariables}
      data-theme={DEFAULT_DESIGN_THEME}
      style={{ height: '100%' }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: buildThemeBootstrapScript() }} />
        <script dangerouslySetInnerHTML={{ __html: paletteScript }} />
      </head>
      <body style={{ height: '100%' }}>
        <ConsentProvider initialConsent={initialConsent}>
          <Providers>{children}</Providers>
          <CookieBanner />
          <ConsentedTrackers />
        </ConsentProvider>
        {/* Cookieless, no cross-site identifier — not gated by consent. */}
        <Analytics />
      </body>
    </html>
  )
}

import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import { fontVariables } from '@/lib/fonts'
import { buildThemeBootstrapScript, DEFAULT_DESIGN_THEME } from '@/lib/design-theme-shared'
import { PALETTE_STORAGE_KEY } from '@/lib/palettes'
import { buildRootMetadata } from '@/lib/seo'
import { Analytics } from "@vercel/analytics/next"
import { GoogleAnalytics } from '@next/third-parties/google'

const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

export const metadata: Metadata = buildRootMetadata()

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070707' },
    { media: '(prefers-color-scheme: light)', color: '#070707' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const paletteScript = `(function(){try{var p=localStorage.getItem('${PALETTE_STORAGE_KEY}');if(p&&p!=='default')document.documentElement.setAttribute('data-palette',p)}catch(e){}})()`

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`dark ${fontVariables}`}
      data-theme={DEFAULT_DESIGN_THEME}
      style={{ height: '100%', colorScheme: 'dark' }}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: buildThemeBootstrapScript() }} />
        <script dangerouslySetInnerHTML={{ __html: paletteScript }} />
      </head>
      <body style={{ height: '100%' }}>
        <Providers>{children}</Providers>
        <Analytics />
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  )
}

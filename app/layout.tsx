import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { fontVariables } from '@/lib/fonts'
import { DESIGN_THEME_STORAGE_KEY, DEFAULT_DESIGN_THEME } from '@/lib/design-theme'
import { PALETTE_STORAGE_KEY } from '@/lib/palettes'

export const metadata: Metadata = {
  title: 'Trackbase',
  description: 'Git-like versioning for music demos',
  viewport: {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const paletteScript = `(function(){try{var p=localStorage.getItem('${PALETTE_STORAGE_KEY}');if(p&&p!=='default')document.documentElement.setAttribute('data-palette',p)}catch(e){}})()`
  const themeScript = `(function(){try{var t=localStorage.getItem('${DESIGN_THEME_STORAGE_KEY}');var d='${DEFAULT_DESIGN_THEME}';document.documentElement.setAttribute('data-theme',t||d);document.documentElement.style.colorScheme=(t||d).endsWith('light')?'light':'dark'}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_DESIGN_THEME}')}})()`

  return (
    <html lang="en" suppressHydrationWarning className={fontVariables} style={{ height: '100%' }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: paletteScript }} />
      </head>
      <body style={{ height: '100%' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

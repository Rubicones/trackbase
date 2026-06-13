import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
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

  return (
    <html lang="en" suppressHydrationWarning style={{ height: '100%' }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: paletteScript }} />
      </head>
      <body style={{ height: '100%' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

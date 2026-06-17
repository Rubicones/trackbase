'use client'

import { Suspense } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/contexts/AuthContext'
import { PaletteProvider } from '@/contexts/PaletteContext'
import { DesignThemeProvider } from '@/lib/design-theme'
import { PageNavigationLoader } from '@/components/PageNavigationLoader'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <DesignThemeProvider>
        <PaletteProvider>
          <AuthProvider>
            <Suspense fallback={null}>
              <PageNavigationLoader />
            </Suspense>
            {children}
          </AuthProvider>
        </PaletteProvider>
      </DesignThemeProvider>
    </ThemeProvider>
  )
}

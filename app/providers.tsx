'use client'

import { Suspense } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/contexts/AuthContext'
import { PaletteProvider } from '@/contexts/PaletteContext'
import { DesignThemeProvider, NEXT_THEMES_STORAGE_KEY } from '@/lib/design-theme'
import { NavigationPlaybackCleanup } from '@/components/NavigationPlaybackCleanup'
import { PushNotificationProvider } from '@/components/push/PushNotificationProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange storageKey={NEXT_THEMES_STORAGE_KEY}>
      <DesignThemeProvider>
        <PaletteProvider>
          <AuthProvider>
            <PushNotificationProvider>
              <Suspense fallback={null}>
                <NavigationPlaybackCleanup />
              </Suspense>
              {children}
            </PushNotificationProvider>
          </AuthProvider>
        </PaletteProvider>
      </DesignThemeProvider>
    </ThemeProvider>
  )
}

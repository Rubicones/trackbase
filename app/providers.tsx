'use client'

import { Suspense } from 'react'
import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/contexts/AuthContext'
import { PaletteProvider } from '@/contexts/PaletteContext'
import { PaywallProvider } from '@/contexts/PaywallContext'
import { DesignThemeProvider, NEXT_THEMES_STORAGE_KEY } from '@/lib/design-theme'
import { NavigationPlaybackCleanup } from '@/components/NavigationPlaybackCleanup'
import { PushNotificationProvider } from '@/components/push/PushNotificationProvider'
import { PageViewTracker } from '@/components/analytics/PageViewTracker'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange storageKey={NEXT_THEMES_STORAGE_KEY}>
      <DesignThemeProvider>
        <PaletteProvider>
          <AuthProvider>
            <PaywallProvider>
              <PushNotificationProvider>
                <Suspense fallback={null}>
                  <NavigationPlaybackCleanup />
                  <PageViewTracker />
                </Suspense>
                {children}
              </PushNotificationProvider>
            </PaywallProvider>
          </AuthProvider>
        </PaletteProvider>
      </DesignThemeProvider>
    </ThemeProvider>
  )
}

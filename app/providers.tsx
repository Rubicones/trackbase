'use client'

import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/contexts/AuthContext'
import { PaletteProvider } from '@/contexts/PaletteContext'
import { DesignThemeProvider } from '@/lib/design-theme'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <DesignThemeProvider>
        <PaletteProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </PaletteProvider>
      </DesignThemeProvider>
    </ThemeProvider>
  )
}

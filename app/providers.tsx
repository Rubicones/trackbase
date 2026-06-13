'use client'

import { ThemeProvider } from 'next-themes'
import { AuthProvider } from '@/contexts/AuthContext'
import { PaletteProvider } from '@/contexts/PaletteContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <PaletteProvider>
        <AuthProvider>
          {children}
        </AuthProvider>
      </PaletteProvider>
    </ThemeProvider>
  )
}

'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  DEFAULT_DESIGN_THEME,
  DESIGN_THEME_STORAGE_KEY,
  DESIGN_THEMES,
  isDesignThemeId,
  NEXT_THEMES_STORAGE_KEY,
  type DesignThemeId,
} from '@/lib/design-theme-shared'
import { syncNativeSystemBars } from '@/lib/nativeSystemBars'

export type { DesignThemeId } from '@/lib/design-theme-shared'
export {
  DEFAULT_DESIGN_THEME,
  DESIGN_THEME_STORAGE_KEY,
  DESIGN_THEMES,
  NEXT_THEMES_STORAGE_KEY,
  isDesignThemeId,
  buildThemeBootstrapScript,
} from '@/lib/design-theme-shared'

export function readStoredDesignTheme(): DesignThemeId {
  if (typeof window === 'undefined') return DEFAULT_DESIGN_THEME
  try {
    const saved = localStorage.getItem(DESIGN_THEME_STORAGE_KEY)
    if (isDesignThemeId(saved)) return saved
  } catch {
    /* noop */
  }
  return DEFAULT_DESIGN_THEME
}

type DesignThemeContextValue = {
  theme: DesignThemeId
  setTheme: (theme: DesignThemeId) => void
}

const DesignThemeContext = createContext<DesignThemeContextValue>({
  theme: DEFAULT_DESIGN_THEME,
  setTheme: () => {},
})

export function applyDesignTheme(theme: DesignThemeId) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  const meta = DESIGN_THEMES.find(t => t.id === theme)
  const isDark = meta?.mode === 'dark'
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', isDark)
  try {
    localStorage.setItem(NEXT_THEMES_STORAGE_KEY, isDark ? 'dark' : 'light')
  } catch {
    /* noop */
  }
  // Keep the native status / navigation bars matched to the app background.
  // The attribute + class changes above have already updated the resolved
  // CSS variables, so reading --background now reflects the new theme.
  syncNativeSystemBars(isDark)
}

export function DesignThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<DesignThemeId>(() => {
    const initial = readStoredDesignTheme()
    if (typeof window !== 'undefined') applyDesignTheme(initial)
    return initial
  })

  const setTheme = (next: DesignThemeId) => {
    setThemeState(next)
    applyDesignTheme(next)
    try {
      localStorage.setItem(DESIGN_THEME_STORAGE_KEY, next)
    } catch {
      /* noop */
    }
  }

  return (
    <DesignThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </DesignThemeContext.Provider>
  )
}

export function useDesignTheme() {
  return useContext(DesignThemeContext)
}

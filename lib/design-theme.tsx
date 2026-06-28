'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  DEFAULT_DESIGN_THEME,
  DESIGN_THEME_STORAGE_KEY,
  DESIGN_THEMES,
  isDesignThemeId,
  normalizeDesignThemeId,
  NEXT_THEMES_STORAGE_KEY,
  type DesignThemeId,
} from '@/lib/design-theme-shared'

export type { DesignThemeId } from '@/lib/design-theme-shared'
export {
  DEFAULT_DESIGN_THEME,
  DESIGN_THEME_STORAGE_KEY,
  DESIGN_THEMES,
  NEXT_THEMES_STORAGE_KEY,
  isDesignThemeId,
  normalizeDesignThemeId,
  buildThemeBootstrapScript,
} from '@/lib/design-theme-shared'

export function readStoredDesignTheme(): DesignThemeId {
  if (typeof window === 'undefined') return DEFAULT_DESIGN_THEME
  try {
    const saved = localStorage.getItem(DESIGN_THEME_STORAGE_KEY)
    const normalized = normalizeDesignThemeId(saved)
    if (normalized) return normalized
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
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  const meta = DESIGN_THEMES.find(t => t.id === theme)
  const isDark = meta?.mode === 'dark'
  root.style.colorScheme = isDark ? 'dark' : 'light'
  root.classList.toggle('dark', isDark)
  try {
    localStorage.setItem(NEXT_THEMES_STORAGE_KEY, isDark ? 'dark' : 'light')
  } catch {
    /* noop */
  }
}

/** Keep next-themes class toggle aligned with design-theme mode (light themes must drop .dark). */
function DesignThemeNextThemesSync() {
  const { theme } = useDesignTheme()
  const { setTheme: setNextTheme } = useTheme()

  useEffect(() => {
    const meta = DESIGN_THEMES.find(t => t.id === theme)
    setNextTheme(meta?.mode === 'dark' ? 'dark' : 'light')
  }, [theme, setNextTheme])

  return null
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
      <DesignThemeNextThemesSync />
      {children}
    </DesignThemeContext.Provider>
  )
}

export function useDesignTheme() {
  return useContext(DesignThemeContext)
}

'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type DesignThemeId =
  | 'ember-dark'
  | 'ember-light'
  | 'blush-dark'
  | 'blush-light'
  | 'studio-dark'
  | 'studio-light'
  | 'studio-paper-dark'

export const DESIGN_THEMES: {
  id: DesignThemeId
  label: string
  mode: 'dark' | 'light'
  swatches: string[]
  description: string
}[] = [
  {
    id: 'ember-dark',
    label: 'Ember Dark',
    mode: 'dark',
    swatches: ['#211f1e', '#2a2826', '#ff5a1f', '#f5f5f5'],
    description: 'Brutalist bone-black canvas with hot ember accent.',
  },
  {
    id: 'ember-light',
    label: 'Ember Light',
    mode: 'light',
    swatches: ['#f5f5f5', '#ffffff', '#ea4d12', '#1a1a1a'],
    description: 'Studio-paper white with the same ember signature.',
  },
  {
    id: 'blush-dark',
    label: 'Blush Dark',
    mode: 'dark',
    swatches: ['#211f1e', '#2a2826', '#f472b6', '#f5f5f5'],
    description: 'Bone-black canvas with a vivid pink accent.',
  },
  {
    id: 'blush-light',
    label: 'Blush Light',
    mode: 'light',
    swatches: ['#f5f5f5', '#ffffff', '#e85d9a', '#1a1a1a'],
    description: 'Clean light studio with a pink accent instead of ember.',
  },
  {
    id: 'studio-dark',
    label: 'Studio Dim',
    mode: 'dark',
    swatches: ['#1f242c', '#2a313b', '#5ac8e6', '#e8ecf1'],
    description: 'Calmer slate-blue night mode with a cool teal accent.',
  },
  {
    id: 'studio-light',
    label: 'Studio Paper',
    mode: 'light',
    swatches: ['#f9f7f3', '#ffffff', '#6d58c8', '#1d2030'],
    description: 'Warm paper background with a muted indigo accent.',
  },
  {
    id: 'studio-paper-dark',
    label: 'Studio Paper Dark',
    mode: 'dark',
    swatches: ['#2a2620', '#332e26', '#8f78e8', '#f0ebe3'],
    description: 'Warm paper-toned night mode with the same indigo accent.',
  },
]

export const DESIGN_THEME_STORAGE_KEY = 'tb-theme'
export const DEFAULT_DESIGN_THEME: DesignThemeId = 'studio-light'

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
  document.documentElement.style.colorScheme = meta?.mode ?? (theme.endsWith('light') ? 'light' : 'dark')
}

export function DesignThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<DesignThemeId>(DEFAULT_DESIGN_THEME)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DESIGN_THEME_STORAGE_KEY) as DesignThemeId | null
      const next =
        saved && DESIGN_THEMES.some(t => t.id === saved) ? saved : DEFAULT_DESIGN_THEME
      setThemeState(next)
      applyDesignTheme(next)
    } catch {
      applyDesignTheme(DEFAULT_DESIGN_THEME)
    }
  }, [])

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

'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import {
  normalizePaletteId,
  PALETTE_STORAGE_KEY,
  type PaletteId,
} from '@/lib/palettes'

type PaletteContextValue = {
  palette: PaletteId
  setPalette: (id: PaletteId) => void
}

const PaletteContext = createContext<PaletteContextValue | null>(null)

function applyPalette(id: PaletteId) {
  const root = document.documentElement
  if (id === 'default') root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', id)
}

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = useState<PaletteId>(() => {
    if (typeof window === 'undefined') return 'default'
    const id = normalizePaletteId(localStorage.getItem(PALETTE_STORAGE_KEY))
    applyPalette(id)
    return id
  })

  const setPalette = useCallback((id: PaletteId) => {
    document.documentElement.classList.add('theme-transition')
    setPaletteState(id)
    applyPalette(id)
    localStorage.setItem(PALETTE_STORAGE_KEY, id)
    window.setTimeout(() => {
      document.documentElement.classList.remove('theme-transition')
    }, 300)
  }, [])

  return (
    <PaletteContext.Provider value={{ palette, setPalette }}>
      {children}
    </PaletteContext.Provider>
  )
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext)
  if (!ctx) {
    return {
      palette: 'default',
      setPalette: () => {},
    }
  }
  return ctx
}

'use client'

import { useEffect, useState, type CSSProperties } from 'react'

export type MobileVisualViewport = {
  top: number
  left: number
  width: number
  height: number
}

/** Pin a fixed element to the visual viewport (flush above the software keyboard). */
export function pinToVisualViewport(viewport: MobileVisualViewport | null): CSSProperties {
  if (!viewport) return {}
  return {
    top: viewport.top,
    left: viewport.left,
    width: viewport.width,
    height: viewport.height,
    bottom: 'auto',
    right: 'auto',
  }
}

/**
 * Track the mobile software keyboard via visualViewport.
 * Returns a rect to pin fixed UI when the keyboard is open.
 */
export function useMobileKeyboardInset(active: boolean) {
  const [viewport, setViewport] = useState<MobileVisualViewport | null>(null)

  useEffect(() => {
    if (!active) {
      setViewport(null)
      return
    }

    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    if (!isMobile || !window.visualViewport) return

    const vv = window.visualViewport
    const sync = () => {
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      if (gap < 8) {
        setViewport(null)
        return
      }
      setViewport({
        top: vv.offsetTop,
        left: vv.offsetLeft,
        width: vv.width,
        height: vv.height,
      })
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      setViewport(null)
    }
  }, [active])

  const keyboardOpen = viewport !== null

  return { viewport, keyboardOpen }
}

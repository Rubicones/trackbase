'use client'

import { useEffect, useState } from 'react'

/** Lift fixed bottom UI above the mobile software keyboard (visualViewport). */
export function useMobileKeyboardInset(active: boolean) {
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!active) {
      setKeyboardInset(0)
      setViewportHeight(null)
      return
    }

    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    if (!isMobile || !window.visualViewport) return

    const vv = window.visualViewport
    const sync = () => {
      setKeyboardInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
      setViewportHeight(vv.height)
    }

    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      setKeyboardInset(0)
      setViewportHeight(null)
    }
  }, [active])

  return { keyboardInset, viewportHeight }
}

'use client'

import { useEffect, useState } from 'react'

/** Returns true when viewport width is below `breakpoint` (default 768). */
export function useBreakpoint(breakpoint = 768) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [breakpoint])

  return matches
}

export function useIsMobile() {
  return useBreakpoint(768)
}

export function useIsNarrow() {
  return useBreakpoint(900)
}

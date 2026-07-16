'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

/**
 * SPA route-change page views only.
 * Initial load is already recorded by <GoogleAnalytics /> — firing again
 * here doubles collect events on every hard reload.
 */
export function PageViewTracker() {
  const pathname = usePathname()
  const prevPathRef = useRef<string | null>(null)
  const skipInitialRef = useRef(true)

  useEffect(() => {
    if (!pathname) return
    if (skipInitialRef.current) {
      skipInitialRef.current = false
      prevPathRef.current = pathname
      return
    }
    if (pathname === prevPathRef.current) return
    prevPathRef.current = pathname
    trackEvent('page_view', { page_path: pathname })
  }, [pathname])

  return null
}

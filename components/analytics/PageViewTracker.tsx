'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

export function PageViewTracker() {
  const pathname = usePathname()
  const prevPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || pathname === prevPathRef.current) return
    prevPathRef.current = pathname
    trackEvent('page_view', { page_path: pathname })
  }, [pathname])

  return null
}

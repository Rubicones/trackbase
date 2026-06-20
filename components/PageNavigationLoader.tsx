'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { MixLoader } from '@/components/MixLoader'
import { getLoadingLabel } from '@/lib/loadingLabels'

function isSameOriginNav(href: string): string | null {
  if (!href || href.startsWith('#')) return null
  try {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin) return null
    if (url.pathname + url.search === window.location.pathname + window.location.search) return null
    return url.pathname
  } catch {
    return null
  }
}

export function PageNavigationLoader() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)
  const [targetPath, setTargetPath] = useState(pathname)
  const routeKey = pathname + searchParams.toString()
  const routeKeyRef = useRef(routeKey)

  // Hide once Next.js pathname catches up to the destination (forward nav).
  useEffect(() => {
    if (!visible) return
    if (pathname === targetPath) setVisible(false)
  }, [visible, pathname, targetPath])

  // Route changed — navigation finished.
  useEffect(() => {
    if (routeKey !== routeKeyRef.current) {
      routeKeyRef.current = routeKey
      setVisible(false)
    }
  }, [routeKey])

  // bfcache restore: pathname may not change, so clear any stuck overlay.
  useEffect(() => {
    const onPageShow = () => setVisible(false)
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Safety net: never leave the navigation overlay stuck if routing aborts.
  useEffect(() => {
    if (!visible) return
    const onPopState = () => setVisible(false)
    window.addEventListener('popstate', onPopState)
    const timeout = window.setTimeout(() => setVisible(false), 12_000)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.clearTimeout(timeout)
    }
  }, [visible])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const el = (e.target as Element).closest('a')
      if (!el || el.getAttribute('target') === '_blank') return
      const path = isSameOriginNav(el.getAttribute('href') ?? '')
      if (!path) return
      setTargetPath(path)
      setVisible(true)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  if (!visible) return null

  return (
    <div className="page-navigation-overlay">
      <MixLoader label={getLoadingLabel(targetPath)} fullscreen={false} />
    </div>
  )
}

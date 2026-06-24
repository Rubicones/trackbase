'use client'

import { useEffect, useState } from 'react'

/** Client-only cookie check for the marketing landing — never blocks SSR. */
export function useLandingAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then(res => {
        if (!cancelled) setIsAuthenticated(res.ok)
      })
      .catch(() => {
        if (!cancelled) setIsAuthenticated(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    isAuthenticated,
    authHref: isAuthenticated ? '/dashboard' : '/auth',
    authLabel: isAuthenticated ? 'DASHBOARD →' : '+ SIGN IN',
  }
}

'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  readConsentCookie,
  writeConsentCookie,
  type ConsentChoice,
  type ConsentState,
} from '@/lib/consent'

type ConsentContextValue = {
  /**
   * The stored choice, or null when none has been made (or it expired).
   * Seeded from the server-read cookie, then re-read from `document.cookie`
   * on mount — the force-static marketing pages are prerendered, so the
   * server sees no cookie there and only the client knows the real answer.
   */
  consent: ConsentState | null
  /** True once the client has read the cookie; the banner never guesses before that. */
  ready: boolean
  /** Banner visible: no choice yet, or reopened from "Cookie settings". */
  bannerOpen: boolean
  /** True when the banner was reopened from "Cookie settings" (vs. first ask). */
  reopened: boolean
  choose: (choice: ConsentChoice) => void
  openSettings: () => void
  closeSettings: () => void
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

/**
 * Tell trackers that already loaded on this page view to stop sending, using
 * each vendor's own documented switch. Nothing is unloaded — the scripts stay
 * in memory until the next full page load, where they are not rendered at all.
 * (Yandex has no equivalent switch; its hits all go through
 * lib/yandex-metrica.ts, which checks consent on every call.)
 */
function setVendorOptOut(optOut: boolean) {
  if (GA_ID) (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = optOut
  window.fbq?.('consent', optOut ? 'revoke' : 'grant')
}

export function ConsentProvider({
  initialConsent,
  children,
}: {
  initialConsent: ConsentState | null
  children: React.ReactNode
}) {
  const [consent, setConsent] = useState<ConsentState | null>(initialConsent)
  const [ready, setReady] = useState(false)
  const [reopened, setReopened] = useState(false)

  useEffect(() => {
    // Reconcile with the browser's cookie (see `consent` doc above).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration read
    setConsent(readConsentCookie())
    setReady(true)
  }, [])

  const choose = useCallback((choice: ConsentChoice) => {
    const next = writeConsentCookie(choice)
    setVendorOptOut(choice === 'rejected')
    setConsent(next)
    setReopened(false)
  }, [])

  const openSettings = useCallback(() => setReopened(true), [])
  const closeSettings = useCallback(() => setReopened(false), [])

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      ready,
      bannerOpen: ready && (consent === null || reopened),
      reopened: reopened && consent !== null,
      choose,
      openSettings,
      closeSettings,
    }),
    [consent, ready, reopened, choose, openSettings, closeSettings],
  )

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext)
  if (!ctx) throw new Error('useConsent must be used inside <ConsentProvider>')
  return ctx
}

'use client'

/**
 * Test-mode paywall — a measurement instrument, not an entitlement system.
 *
 * The "Show paywall" toggle (Preferences → Testing) is persisted per user in
 * localStorage.  It is presentation-layer only: nothing is gated server-side,
 * no capability changes.  With the toggle OFF the app is byte-for-byte the
 * same experience as before this feature existed.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { PlansModal } from '@/components/paywall/PlansModal'

export type PaywallFeature = 'chord_detect' | 'cherry_pick' | 'track_edit' | 'ab_compare'
export type PaywallSource = PaywallFeature | 'avatar_menu'

const STORAGE_PREFIX = 'sd-paywall-test:'

// ── Per-user toggle store (localStorage + in-memory fallback) ────────────────

const listeners = new Set<() => void>()
/** Fallback when localStorage is unavailable (private mode etc.) — session-only. */
const memoryStore = new Map<string, boolean>()

function emitChange() {
  listeners.forEach(l => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  // Cross-tab sync for free via the storage event.
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

function readEnabled(userId: string | null): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(STORAGE_PREFIX + userId) === '1'
  } catch {
    return memoryStore.get(userId) ?? false
  }
}

function writeEnabled(userId: string, next: boolean) {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, next ? '1' : '0')
  } catch {
    memoryStore.set(userId, next)
  }
  emitChange()
}

// ── Context ──────────────────────────────────────────────────────────────────

interface PaywallContextValue {
  /** True when the "Show paywall" testing toggle is ON for the current user. */
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  openPaywall: (source: PaywallSource) => void
}

const PaywallContext = createContext<PaywallContextValue>({
  enabled: false,
  setEnabled: () => {},
  openPaywall: () => {},
})

export function usePaywall() {
  return useContext(PaywallContext)
}

/**
 * Gate helper for a locked feature entry point.
 * `locked` is true when the test paywall is on; `onLockedClick` records the
 * demand signal and opens the plans modal.
 */
export function usePaywallGate(feature: PaywallFeature) {
  const { enabled, openPaywall } = usePaywall()
  const onLockedClick = useCallback(() => {
    trackEvent('paywall_lock_clicked', { feature })
    openPaywall(feature)
  }, [feature, openPaywall])
  return { locked: enabled, onLockedClick }
}

export function PaywallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // Signed out (and on the server) → always false: the paywall cannot exist
  // for a user who never turned the toggle on.
  const enabled = useSyncExternalStore(
    subscribe,
    () => readEnabled(userId),
    () => false,
  )

  // Modal state intentionally lives outside the context value so opening the
  // modal doesn't re-render every gated consumer.
  const [modalSource, setModalSource] = useState<PaywallSource | null>(null)

  const setEnabled = useCallback(
    (next: boolean) => {
      if (userId) writeEnabled(userId, next)
      trackEvent('paywall_toggle_changed', { enabled: next })
    },
    [userId],
  )

  const openPaywall = useCallback((source: PaywallSource) => {
    setModalSource(source)
  }, [])

  const value = useMemo(
    () => ({ enabled, setEnabled, openPaywall }),
    [enabled, setEnabled, openPaywall],
  )

  return (
    <PaywallContext.Provider value={value}>
      {children}
      {modalSource && (
        <PlansModal source={modalSource} onClose={() => setModalSource(null)} />
      )}
    </PaywallContext.Provider>
  )
}

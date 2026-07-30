'use client'

/**
 * Test-mode paywall — a measurement instrument, not an entitlement system.
 *
 * The "Show paywall" toggle (Preferences → Testing) is persisted per user in
 * localStorage.  It is presentation-layer only: nothing is gated server-side,
 * no capability changes.  With the toggle OFF the app is byte-for-byte the
 * same experience as before this feature existed.
 *
 * **Local development only.** `PAYWALL_TEST_MODE_AVAILABLE` gates both the
 * toggle UI and `enabled` itself, so on any deployed build (preview included)
 * the paywall cannot appear — not even for a user whose localStorage flag was
 * left ON from before this restriction. Gating the *value* and not just the
 * switch is the point: hiding only the switch would strand those users behind
 * locks with no way to turn them off. The stored key is deliberately left in
 * place rather than cleared, so flipping back to dev restores their setting.
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

/**
 * Whether the test paywall exists at all in this build.
 *
 * `next dev` only. NODE_ENV is 'production' for every `next build`, which
 * includes Vercel preview deployments — so this is stricter than "not
 * sonicdesk.studio" and hides the feature on preview URLs too.
 */
export const PAYWALL_TEST_MODE_AVAILABLE = process.env.NODE_ENV === 'development'

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
  // Outside local dev the stored flag is ignored entirely (see the header).
  if (!PAYWALL_TEST_MODE_AVAILABLE) return false
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
      // Unreachable outside dev (the switch isn't rendered), but guarded so a
      // future caller can't resurrect the paywall in production.
      if (!PAYWALL_TEST_MODE_AVAILABLE) return
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

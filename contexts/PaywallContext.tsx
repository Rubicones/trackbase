'use client'

/**
 * Plan context — what this account is entitled to, for the UI.
 *
 * This replaces the measurement-only test paywall that used to live here. That
 * version was a localStorage toggle that gated nothing: `enabled` was a
 * per-user preference, the gated feature list was hardcoded, and no server
 * check existed. All three are gone. Locking is now driven by the real plan,
 * resolved server-side by `lib/entitlements.ts` and served by
 * `GET /api/me/plan`.
 *
 * **This is display, not enforcement.** Everything here can be lied to by a
 * hostile client and it changes nothing: every limit and every gated feature
 * is checked again on the server, from the database, on every request. The job
 * of this file is to make the UI honest about what the user has, and to
 * explain it — not to be the gate.
 *
 * The "Subscribe" button still writes to `subscription_intents`
 * (`POST /api/paywall/intent`) because there is still no checkout. That is
 * demand measurement and it is unrelated to entitlements.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { apiErrorMessage, parseLimitRefusal } from '@/lib/planCopy'
import { trackLimitReached } from '@/lib/planAnalytics'
import { PlansModal } from '@/components/paywall/PlansModal'
import {
  DEFAULT_PLAN,
  PLANS,
  type GatedFeature,
  type Limit,
  type PlanId,
} from '@/lib/plans'
import { DEV_PLAN_TOOLS_AVAILABLE as DEV_PLAN_TOOLS } from '@/lib/devPlanTools'

/** Kept as the historical name so existing call sites read unchanged. */
export type PaywallFeature = GatedFeature
export type PaywallSource = PaywallFeature | 'avatar_menu' | 'preferences' | 'limit'

/**
 * Whether the dev-only plan tooling is reachable in this build.
 *
 * Re-exported from `lib/devPlanTools.ts` so the client control, `/api/dev/plan`
 * and `POST /api/me/plan` are provably the same test — hiding the switcher is
 * the last line of defence, not the only one.
 */
export const DEV_PLAN_TOOLS_AVAILABLE = DEV_PLAN_TOOLS

/** Back-compat alias for the old flag name. */
export const PAYWALL_TEST_MODE_AVAILABLE = DEV_PLAN_TOOLS_AVAILABLE

export type PlanState = 'active' | 'grace' | 'enforced'

export interface PlanLimits {
  bandsOwned: Limit
  membersPerBand: Limit
  storagePerBandMB: Limit
  storagePerBandBytes: number | null
  activeVersionsPerProject: Limit
}

export interface PlanUsageBand {
  id: string
  name: string
  memberCount: number
  storageBytes: number
  lastActivityAt: string
  frozen: boolean
  frozenReason: string | null
}

export interface PlanSnapshot {
  plan: PlanId
  state: PlanState
  graceUntil: string | null
  graceDaysLeft: number
  keepBandIds: string[]
  provisioned: boolean
  limits: PlanLimits
  features: GatedFeature[]
  bandsOwnedOverridden: boolean
  usage: { bandsOwned: number; bands: PlanUsageBand[] }
}

const EMPTY_SNAPSHOT: PlanSnapshot = {
  plan: DEFAULT_PLAN,
  state: 'active',
  graceUntil: null,
  graceDaysLeft: 0,
  keepBandIds: [],
  // Until the first fetch lands we assume the plan system is not live. That
  // means nothing is locked. Guessing "locked" would flash a paywall over
  // features a paying user has, every single page load.
  provisioned: false,
  limits: {
    bandsOwned: PLANS[DEFAULT_PLAN].bandsOwned,
    membersPerBand: PLANS[DEFAULT_PLAN].membersPerBand,
    storagePerBandMB: PLANS[DEFAULT_PLAN].storagePerBandMB,
    storagePerBandBytes: null,
    activeVersionsPerProject: PLANS[DEFAULT_PLAN].activeVersionsPerProject,
  },
  features: [],
  bandsOwnedOverridden: false,
  usage: { bandsOwned: 0, bands: [] },
}

interface PaywallContextValue {
  snapshot: PlanSnapshot
  loading: boolean
  /** Re-fetch after anything that could change entitlements. */
  refresh: () => Promise<void>
  openPaywall: (source: PaywallSource) => void
}

const PaywallContext = createContext<PaywallContextValue>({
  snapshot: EMPTY_SNAPSHOT,
  loading: true,
  refresh: async () => {},
  openPaywall: () => {},
})

export function usePaywall() {
  return useContext(PaywallContext)
}

/** The current plan snapshot on its own, for surfaces that only read it. */
export function usePlan(): PlanSnapshot {
  return useContext(PaywallContext).snapshot
}

/**
 * Gate helper for a locked feature entry point.
 *
 * `locked` is true when the band's plan does not include the feature.
 * `onLockedClick` records the demand signal and opens the plans modal.
 *
 * Note the deliberate simplification: this resolves against the *user's* plan,
 * because that is what the client knows. The server resolves against the
 * BAND's plan, which is the real rule — a free user inside a paid band gets
 * the feature. The consequence is a UI that can under-promise (showing a lock
 * to someone who would in fact be allowed) and never over-promises. Passing a
 * bandId lifts that: pass one wherever the band is known.
 */
export function usePaywallGate(feature: PaywallFeature, bandFeatures?: GatedFeature[] | null) {
  const { snapshot, openPaywall } = usePaywall()

  const source = bandFeatures ?? (snapshot.provisioned ? snapshot.features : null)
  // `null` means "we do not know yet" (or the plan system is not live) — do
  // not lock on a guess.
  const locked = source !== null && !source.includes(feature)

  const onLockedClick = useCallback(() => {
    trackEvent('paywall_lock_clicked', { feature })
    openPaywall(feature)
  }, [feature, openPaywall])

  return { locked, onLockedClick }
}

/**
 * Turn any API error body into a sentence for the user, and — when it is a
 * structured limit refusal — record `limit_reached` with the current plan.
 *
 * Both halves belong together: the moment we have enough information to tell
 * the user which ceiling they hit is exactly the moment worth measuring, and
 * splitting them is how one of the two ends up missing from a code path.
 */
export function useApiErrorMessage() {
  const { snapshot } = usePaywall()
  return useCallback(
    (data: unknown, fallback: string): string => {
      const refusal = parseLimitRefusal(data)
      if (refusal) trackLimitReached(refusal.limit_type, snapshot.plan)
      return apiErrorMessage(data, fallback)
    },
    [snapshot.plan],
  )
}

export function PaywallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // `null` = never fetched. Signed-out is derived in render rather than
  // written by an effect, which keeps this provider free of a synchronous
  // setState on mount.
  const [fetched, setFetched] = useState<PlanSnapshot | null>(null)
  const [fetching, setFetching] = useState(true)
  const [modalSource, setModalSource] = useState<PaywallSource | null>(null)

  const snapshot = userId ? (fetched ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT
  const loading = userId ? fetching : false

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch('/api/me/plan')
      if (!res.ok) throw new Error(`plan fetch failed (${res.status})`)
      const data = (await res.json()) as PlanSnapshot
      setFetched({ ...EMPTY_SNAPSHOT, ...data })
    } catch (err) {
      // Leave the previous snapshot in place. A transient failure must not
      // lock a paying user out of their own features.
      console.error('[plan] could not load entitlements', err)
    } finally {
      setFetching(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openPaywall = useCallback((source: PaywallSource) => {
    setModalSource(source)
  }, [])

  const value = useMemo(
    () => ({ snapshot, loading, refresh, openPaywall }),
    [snapshot, loading, refresh, openPaywall],
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

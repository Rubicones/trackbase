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
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { apiErrorMessage, parseLimitRefusal } from '@/lib/planCopy'
import { trackLimitReached } from '@/lib/planAnalytics'
import { PlansModal } from '@/components/paywall/PlansModal'
import { PaidFeatureModal } from '@/components/paywall/PaidFeatureModal'
import {
  DEFAULT_PLAN,
  GATED_FEATURES,
  PLANS,
  type AddonType,
  type GatedFeature,
  type Limit,
  type PlanId,
} from '@/lib/plans'
import { EMPTY_PRICE_CATALOG, type PriceCatalog } from '@/lib/planPrices'
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

export interface PlanAddon {
  id: string
  type: AddonType
  /** Null for account-wide addons (`extra_band`). */
  bandId: string | null
  quantity: number
  /**
   * `stripe` renews; `ending` was removed and runs out at `endsAt` (already
   * paid for); `manual` was granted by hand. Optional so an older server
   * response still parses — absent reads as `stripe`.
   */
  source?: 'stripe' | 'ending' | 'manual'
  endsAt?: string | null
}

export interface PlanSnapshot {
  /**
   * True once this snapshot carries a real answer — from a server-rendered
   * `initialSnapshot`, from `GET /api/me/plan`, or from knowing the visitor is
   * signed out.
   *
   * This exists because `provisioned` used to carry two unrelated meanings at
   * once: the server's "the plan schema is not in the database" and the
   * client's "the fetch has not landed yet". Both unlocked everything, so
   * every gate in the app read as unlocked for the whole of every page load,
   * and there was no way to tell the two apart from the snapshot. `provisioned`
   * now means only what the server means by it; "not yet known" is this.
   */
  resolved: boolean
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
  /**
   * Whether this deployment can take a payment. Resolved server-side from the
   * Stripe configuration (`lib/billing/config.ts`) — the browser has no way to
   * know, and guessing `true` would send a user to a checkout that 404s.
   */
  billingLive: boolean
  /** Explains a raised ceiling; never used to compute one. */
  addons: PlanAddon[]
  /**
   * What each plan and add-on costs, read from Stripe by the server. An entry
   * is absent when Stripe could not be asked — render no price then, never a
   * remembered one. Format with `formatCatalogPrice()` (`lib/planPrices.ts`).
   */
  prices: PriceCatalog
}

const EMPTY_SNAPSHOT: PlanSnapshot = {
  // Nothing has answered yet. Gates read this as `pending` and render a
  // control with no click handler attached at all — see `usePaywallGate`.
  resolved: false,
  plan: DEFAULT_PLAN,
  state: 'active',
  graceUntil: null,
  graceDaysLeft: 0,
  keepBandIds: [],
  // The server's meaning, and only the server's: false = the plan schema is
  // not in the database, so nothing is gated (legacy mode). It no longer
  // doubles as "not loaded yet" — that is `resolved`, above.
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
  // Assume no billing until the server says otherwise: the wrong guess here
  // costs a redirect to a checkout that does not exist.
  billingLive: false,
  addons: [],
  prices: EMPTY_PRICE_CATALOG,
}

/**
 * A visitor we know is not signed in.
 *
 * Resolved on purpose: without it every gate would sit in `pending` forever on
 * a signed-out render, which looks like a hung page. Free carries no gated
 * features, so everything reads as locked — correct, and unreachable in
 * practice since `middleware.ts` redirects anonymous traffic away from the
 * app shell before it renders.
 */
const SIGNED_OUT_SNAPSHOT: PlanSnapshot = { ...EMPTY_SNAPSHOT, resolved: true }

interface PaywallContextValue {
  snapshot: PlanSnapshot
  loading: boolean
  /**
   * Re-fetch after anything that could change entitlements, and hand the
   * caller what came back.
   *
   * This is the ONLY way the snapshot is invalidated. `PaywallProvider` fetches
   * once per mount, so a plan that changes elsewhere — a webhook landing while
   * the tab is open, a return from checkout — leaves every `usePaywallGate()`
   * in the tree reading a stale answer until a full page load. For `ab_compare`
   * and `chord_detect` that snapshot is the only gate there is.
   *
   * Returning the snapshot (rather than `void`) is what lets a caller poll with
   * this instead of fetching `/api/me/plan` beside it: one request both answers
   * "has it changed yet" and refreshes what the rest of the UI sees. Null means
   * the fetch failed and the previous snapshot is still in place.
   */
  refresh: () => Promise<PlanSnapshot | null>
  openPaywall: (source: PaywallSource) => void
}

const PaywallContext = createContext<PaywallContextValue>({
  snapshot: EMPTY_SNAPSHOT,
  loading: true,
  refresh: async () => null,
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
 * What a gated entry point should render.
 *
 *   `allowed` — the band's plan includes the feature. Render the real control.
 *   `locked`  — it does not. Render the locked treatment: dimmed, badged and
 *               still clickable, because the click is what opens the plans
 *               modal and records the demand signal.
 *   `pending` — nobody has answered yet. Render a control that CANNOT be used.
 *
 * ⚠ `pending` must never render the real control, not even DOM-disabled.
 * `disabled` is an attribute, and an attribute is one devtools edit — or one
 * `document.querySelector(…).disabled = false` — away from being gone, which
 * on a quick hand is a free use of a paid feature on every page load. A React
 * `onClick` that was never attached cannot be restored that way: there is no
 * handler in the DOM to re-enable, and no amount of editing markup creates
 * one. So the pending branch renders its own inert markup carrying no handler,
 * and `guard()` below refuses a second time in case some path still reaches a
 * real control.
 *
 * Note the deliberate simplification of the SOURCE: with no `bandFeatures` this
 * resolves against the *user's* plan, because that is what the client knows.
 * The server resolves against the BAND's plan, which is the real rule — a free
 * user inside a paid band gets the feature. Every mixer call site passes
 * `bandFeatures`; `lib/plans.ts` explains why that is load-bearing rather than
 * cosmetic for `ab_compare` and `chord_detect`.
 */
export type GateStatus = 'pending' | 'locked' | 'allowed'

export function usePaywallGate(feature: PaywallFeature, bandFeatures?: GatedFeature[] | null) {
  const { snapshot, openPaywall } = usePaywall()

  // `null` = no answer yet, from either source. It does not mean "unlocked".
  const source: readonly GatedFeature[] | null =
    bandFeatures ?? (snapshot.resolved ? snapshot.features : null)

  const status: GateStatus =
    source === null ? 'pending' : source.includes(feature) ? 'allowed' : 'locked'

  const onLockedClick = useCallback(() => {
    trackEvent('paywall_lock_clicked', { feature })
    openPaywall(feature)
  }, [feature, openPaywall])

  /**
   * Second line of defence — wrap the real action so it refuses on its own.
   *
   * The render branch is what a user sees; this is what survives a control that
   * got mounted anyway: a keyboard activation on edited markup, or a call site
   * that forgets the pending branch.
   *
   * Deliberately NOT memoised, and deliberately closing over `status` rather
   * than reading it from a ref. Every call site wraps its handler inline in the
   * same component that calls this hook, so the wrapper is rebuilt on the
   * render where the status changes — a ref would buy nothing and would read
   * `.current` during render, which this codebase has enough of already.
   */
  const guard = (action: () => void) => () => {
    if (status === 'allowed') {
      action()
      return
    }
    if (status === 'locked') {
      trackEvent('paywall_lock_clicked', { feature })
      openPaywall(feature)
    }
    // `pending`: do nothing. It lasts one round trip, the control is visibly
    // inert, and running the action is the exact leak this replaces.
  }

  return {
    status,
    pending: status === 'pending',
    /** Kept as the historical name so existing call sites read unchanged. */
    locked: status === 'locked',
    onLockedClick,
    guard,
  }
}

/**
 * Every subscription event, with who the user is planwise already attached.
 *
 * The ask was "collect analytics on everything to do with subscriptions, and
 * send which plan the user is on". Writing that by hand at each call site is
 * the version that rots: the next button someone adds will ship without it and
 * nobody will notice until the funnel is being read months later. So the plan
 * is injected here instead, and a call site only names what it did.
 *
 * ⚠ The injected key is `current_plan`, NOT `plan`. Several existing events
 * already use `plan` for the plan being *acted on* — the card someone clicked
 * Subscribe on, the tier a limit belongs to. Reusing that name would have the
 * viewer's own plan silently overwrite the target in half the funnel.
 *
 * `plan_state` rides along because "clicked upgrade" means something different
 * from a healthy account than from one three days into grace.
 *
 * No PII, same rule as the rest of this file's neighbours in
 * `lib/planAnalytics.ts`: plan ids, states, counts and enum-ish strings only.
 */
export function usePlanTracking() {
  const { snapshot } = usePaywall()

  // The returned function is STABLE on purpose, and reads the snapshot through
  // a ref rather than closing over it.
  //
  // Closing over it means a new identity every time the plan refreshes — and
  // call sites list this in effect dependency arrays. One of those effects
  // reports "the feature modal was opened"; with an unstable identity it would
  // report it again every time a background refresh landed while the modal sat
  // open, and the open counts would quietly inflate.
  const latest = useRef(snapshot)
  useEffect(() => {
    latest.current = snapshot
  }, [snapshot])

  return useCallback(
    (event: string, params: Record<string, string | number | boolean> = {}) => {
      const s = latest.current
      trackEvent(event, {
        current_plan: s.plan,
        plan_state: s.state,
        billing_live: s.billingLive,
        ...params,
      })
    },
    [],
  )
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

/**
 * Attempts at `GET /api/me/plan` before a gate is allowed to settle.
 *
 * Retrying matters more than it used to. A gate that cannot resolve now sits
 * in `pending`, and `pending` is inert — one dropped request used to mean an
 * over-permissive UI, and would now mean a dead button instead. Same shape as
 * the profile retry in `AuthContext`.
 */
const PLAN_FETCH_RETRIES = 3
const PLAN_FETCH_BACKOFF_MS = 400

export function PaywallProvider({
  children,
  initialSnapshot,
}: {
  children: ReactNode
  /**
   * Entitlements already resolved on the server and handed down by a server
   * component (`components/plan/PlanBoot.tsx`, from the signed plan cookie).
   *
   * When it is present there is no unknown window at all on a full page load:
   * the gates are correct in the first rendered byte, and the fetch below
   * becomes a background top-up for usage figures rather than the thing every
   * gate is waiting on.
   */
  initialSnapshot?: PlanSnapshot | null
}) {
  const { user, loading: authLoading } = useAuth()
  const userId = user?.id ?? null

  // `null` = never answered. Signed-out is derived in render rather than
  // written by an effect, which keeps this provider free of a synchronous
  // setState on mount.
  const [fetched, setFetched] = useState<PlanSnapshot | null>(initialSnapshot ?? null)
  const [fetching, setFetching] = useState(!initialSnapshot)
  const [modalSource, setModalSource] = useState<PaywallSource | null>(null)
  const [featureModal, setFeatureModal] = useState<GatedFeature | null>(null)

  // Three cases, deliberately not collapsed into two:
  //   signed in           → whatever we have, unresolved until it lands
  //   auth still loading  → unresolved; we do not yet know there is no user,
  //                         and guessing "signed out" here would flash a lock
  //                         over every paid control on every reload
  //   definitely signed out → resolved, so gates settle instead of hanging
  const snapshot = userId
    ? (fetched ?? EMPTY_SNAPSHOT)
    : authLoading
      ? EMPTY_SNAPSHOT
      : SIGNED_OUT_SNAPSHOT
  const loading = userId ? fetching : authLoading

  const refresh = useCallback(async (): Promise<PlanSnapshot | null> => {
    if (!userId) return null

    let lastErr: unknown = null
    for (let attempt = 0; attempt < PLAN_FETCH_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, PLAN_FETCH_BACKOFF_MS * attempt))
      }
      try {
        const res = await fetch('/api/me/plan')
        if (!res.ok) throw new Error(`plan fetch failed (${res.status})`)
        const data = (await res.json()) as PlanSnapshot
        const next = { ...EMPTY_SNAPSHOT, ...data, resolved: true }
        setFetched(next)
        setFetching(false)
        return next
      } catch (err) {
        lastErr = err
      }
    }

    // Retries exhausted.
    //
    // An existing snapshot is left alone: a transient failure must not lock a
    // paying user out of what they already had. With nothing to fall back on
    // the choice is between a control that stays `pending` forever — which
    // reads as a broken page — and one that settles as locked. It settles:
    // a locked control still opens the plans modal, and that modal calls
    // `refresh()` before it offers to sell anything, so a paying user who
    // lands here gets one dimmed button and a correction on the first click
    // rather than a dead screen.
    console.error('[plan] could not load entitlements', lastErr)
    setFetched(prev => prev ?? { ...EMPTY_SNAPSHOT, resolved: true })
    setFetching(false)
    return null
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * A LOCKED FEATURE gets explained before it gets priced.
   *
   * Someone who just clicked a lock asked "what is this", and a table of plans
   * answers "what does it cost". So a gated-feature source opens
   * `PaidFeatureModal` first and only reaches `PlansModal` through its "See
   * plans" button. Every other source — the avatar menu, preferences, a
   * ceiling — is already a pricing question and goes straight there.
   *
   * The demand signal is unaffected: `usePaywallGate` fires
   * `paywall_lock_clicked` before this runs, and `PlansModal` still records its
   * own open with the original source, so the funnel stays one chain.
   */
  const openPaywall = useCallback((source: PaywallSource) => {
    if ((GATED_FEATURES as readonly string[]).includes(source)) {
      setFeatureModal(source as GatedFeature)
      return
    }
    setModalSource(source)
  }, [])

  const value = useMemo(
    () => ({ snapshot, loading, refresh, openPaywall }),
    [snapshot, loading, refresh, openPaywall],
  )

  return (
    <PaywallContext.Provider value={value}>
      {children}
      {featureModal && (
        <PaidFeatureModal
          feature={featureModal}
          onClose={() => setFeatureModal(null)}
          onSeePlans={() => {
            // Hand the ORIGINAL source through, so the plans modal still
            // reports which lock started this rather than a generic entry.
            setModalSource(featureModal)
            setFeatureModal(null)
          }}
        />
      )}
      {modalSource && (
        <PlansModal source={modalSource} onClose={() => setModalSource(null)} />
      )}
    </PaywallContext.Provider>
  )
}

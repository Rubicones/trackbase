'use client'

/**
 * The plans modal.
 *
 * The design is a port of the subscription design kit's "Plans modal"
 * (`sonicdesk_designs`, `/uikit/subscriptions` → "Inspect full modal"), one
 * deliberate omission aside: the kit's monthly/yearly cadence toggle is not
 * here, because this app bills one cadence.
 *
 * Second deviation: the kit's backdrop is a flat `bg-black/85`, which under a
 * light theme frames a near-white sheet in a black surround. Here the scrim is
 * the blur itself — `backdrop-blur-xl` over a thin `--background` tint — so it
 * reads the same way in every theme.
 *
 * Shape of the kit, which this file keeps: a full-height sheet inside a
 * scrolling backdrop (the page scrolls, not a pane inside the modal), an
 * animated 28-bar EQ strip sitting on the header baseline, a 1 / 2 / 4 card
 * grid drawn as hairlines (`gap-px` over a border-coloured backdrop), cards
 * on a five-row grid so price and CTA line up, and a confirmation state that
 * takes over the whole sheet.
 *
 * The kit paints on its own palette; the mapping is the same one fixed in
 * `components/plan/ui.tsx` — `--sub-bg` → `--background`, `--sub-panel` →
 * `--surface`, `--sub-card` → `--card`, `--sub-line` → `--border`,
 * `--sub-fg` → `--foreground`, `--sub-muted` → `--muted-foreground`,
 * `--color-primary` → `--lime`.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 * Nowhere in this file. Limits are `planLimitRows()`, the "plus:" bullets are
 * `planUpgradeHighlights()`, prices are `PLANS[id].price` — all generated from
 * `lib/plans.ts`, the same constant the server enforces. Only the blurb and
 * the accent colour are written here, because neither is a promise anyone can
 * hold us to. The previous version listed capacity by hand and drifted: it
 * advertised a "3 bands as a member" cap that has never existed.
 *
 * ── No tradeoff caveat on the cards ─────────────────────────────────────────
 * Free allows 3 members per band; Solo allows 2, so that one upgrade lowers a
 * ceiling and `planChange` refuses it as a blocking conflict. The cards used
 * to warn about it via `planTradeoffs()`; the warning was removed on request,
 * to keep the cards identical to the kit. The conflict itself still exists —
 * `PlanConflictResolver` is now the only place the user meets it, after they
 * have clicked.
 *
 * ── Two modes ───────────────────────────────────────────────────────────────
 * With billing live, Subscribe opens a Stripe Checkout session and the browser
 * leaves. Without it — no keys configured — the button keeps the behaviour the
 * app has today: record demand in `subscription_intents` and show the waitlist
 * confirmation. The server decides which, via `billingLive` on the plan
 * snapshot; the browser cannot see the Stripe configuration and must not guess.
 *
 * GA4 gets behaviour only: no email, user id, band or project names in params.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, CircleAlert, X } from 'lucide'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { LucideIcon } from '@/components/design/LucideIcon'
import { Spinner } from '@/components/ui/Spinner'
import { Eyebrow, StatusBadge } from '@/components/plan/ui'
import { usePaywall, type PaywallSource } from '@/contexts/PaywallContext'
import { apiErrorMessage } from '@/lib/planCopy'
import {
  FEATURE_LABELS,
  GATED_FEATURES,
  PLANS,
  PLAN_ORDER,
  planLimitRows,
  planUpgradeHighlights,
  type PaidPlanId,
  type PlanId,
} from '@/lib/plans'

const HOVER_DWELL_THRESHOLD_MS = 500

/** Monotonic clock for duration measurements (event-handler-only usage). */
function nowMs() {
  return performance.now()
}

function emptySubscribe() {
  return () => {}
}

// ── Local copy ───────────────────────────────────────────────────────────────

interface PlanCopy {
  blurb: string | null
  /** Accent colour for the plan's square and list markers. */
  color: string
  featured?: boolean
}

const PLAN_COPY: Record<PlanId, PlanCopy> = {
  free: {
    blurb: 'A real workspace for a first record, not a disposable trial.',
    color: 'var(--plan-mint)',
  },
  solo: {
    blurb: 'For independent musicians working alone or with one collaborator.',
    color: 'var(--plan-violet)',
  },
  band: {
    blurb: 'For small bands actively working together.',
    color: 'var(--plan-lime)',
    featured: true,
  },
  band_plus: {
    blurb: 'For active bands running multiple projects or several bands.',
    color: 'var(--plan-amber)',
  },
}

/**
 * What Free includes.
 *
 * The only hand-written feature list in the file, and unavoidably so: Free's
 * value is everything the app does that is *not* gated, and no constant
 * enumerates the whole product. Keep it describing features, never limits —
 * limits are rendered from `planLimitRows()` directly above it.
 */
const FREE_INCLUDED = [
  'Versioning — create versions, apply to Master',
  'MIDI editor (piano roll)',
  'Song structure editor with manual chords',
  'Waveform comments with threads',
  'Band chat, per project and band-wide',
  'Resources — files, links, lyrics',
  'Roadmap and checklist',
  'Recording and Rehearsal Mode',
  'Individual stem download',
]

/**
 * Decorative EQ strip — the kit's 28 bars, one accent colour, uneven idle
 * heights animated on their own clocks. Precomputed so render stays pure.
 */
const EQ_BARS = Array.from({ length: 28 }, (_, i) => ({
  heightPct: 35 + ((i * 31) % 60),
  durationMs: 1300 + (i % 5) * 120,
  delayMs: (i * 63) % 900,
}))

// ── Modal ────────────────────────────────────────────────────────────────────

export function PlansModal({
  source,
  onClose,
}: {
  source: PaywallSource
  onClose: () => void
}) {
  const { user } = useAuth()
  const { snapshot: plan, refresh } = usePaywall()
  // The card marked "Current plan" comes from the resolved entitlements, not
  // from a hardcoded 'free' — a paying user must not be told they are on free.
  const currentPlan = plan.plan
  const billingLive = plan.billingLive

  const [confirmedPlan, setConfirmedPlan] = useState<PaidPlanId | null>(null)
  const [pendingPlan, setPendingPlan] = useState<PaidPlanId | null>(null)
  const [error, setError] = useState('')

  const openTimeRef = useRef(0)
  const closedRef = useRef(true)
  const reachedRef = useRef(false)
  const lastEngagedPlanRef = useRef<PlanId | 'none'>('none')
  const hoverStartRef = useRef<{ plan: PlanId; t: number } | null>(null)

  const fireClosed = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    trackEvent('paywall_modal_closed', {
      source,
      duration_ms: Math.round(nowMs() - openTimeRef.current),
      reached_confirmation: reachedRef.current,
      plan_at_close: lastEngagedPlanRef.current,
    })
  }, [source])

  // Re-read entitlements the moment this opens.
  //
  // The snapshot is fetched once per provider mount, so by the time anyone
  // reaches this modal it can be minutes old — or, when the fetch failed
  // outright, the settled-as-locked fallback `PaywallProvider` falls back to.
  // Both end the same way: offering to sell a plan the user already has. One
  // request before the cards render is cheap; that mistake is the most
  // expensive one this modal can make, and it is the recovery path every
  // locked control quietly depends on.
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    openTimeRef.current = nowMs()
    closedRef.current = false
    trackEvent('paywall_modal_opened', { source })
    // Safety net: any unmount (navigation, parent teardown) still records the close.
    return fireClosed
  }, [source, fireClosed])

  useEffect(() => {
    // Fires after the confirmation state has rendered — the user completed the flow.
    if (confirmedPlan) trackEvent('paywall_waitlist_confirmed', { plan: confirmedPlan, source })
  }, [confirmedPlan, source])

  // Every exit path funnels through here: X button, backdrop click, Escape,
  // and "Back to Sonicdesk" in the confirmation state.
  const handleClose = useCallback(() => {
    fireClosed()
    onClose()
  }, [fireClosed, onClose])

  // ── Bespoke modal shell (portal + scroll lock + Escape) ────────────────────
  // SSR-safe "is the DOM available" flag without a mount-effect setState.
  const domReady = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  useBodyScrollLock(domReady)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Leaving mid-redirect would strand a checkout the user already started.
      if (e.key === 'Escape' && !pendingPlan) handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose, pendingPlan])

  function handleCardPointerEnter(id: PlanId, e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    lastEngagedPlanRef.current = id
    hoverStartRef.current = { plan: id, t: nowMs() }
  }

  function handleCardPointerLeave(id: PlanId, e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    const start = hoverStartRef.current
    hoverStartRef.current = null
    if (!start || start.plan !== id) return
    const dwell = Math.round(nowMs() - start.t)
    // Below the threshold it's mouse travel, not interest — don't pollute the data.
    if (dwell > HOVER_DWELL_THRESHOLD_MS) {
      trackEvent('paywall_plan_viewed', { plan: id, dwell_ms: dwell })
    }
  }

  function handleCardPointerDown(id: PlanId, e: PointerEvent) {
    lastEngagedPlanRef.current = id
    // Hover doesn't exist on touch — a tap is the engagement signal there.
    if (e.pointerType === 'touch') {
      trackEvent('paywall_plan_viewed', { plan: id, dwell_ms: 0 })
    }
  }

  const handleSubscribe = useCallback(
    async (target: PaidPlanId) => {
      trackEvent('paywall_subscribe_clicked', {
        plan: target,
        source,
        time_to_click_ms: Math.round(nowMs() - openTimeRef.current),
        billing_live: billingLive,
      })
      reachedRef.current = true
      setError('')

      if (!billingLive) {
        // No checkout exists yet. The confirmation is the UX contract; the row
        // is our bookkeeping, and a failed write must never block or punish
        // the user — log and move on.
        setConfirmedPlan(target)
        void fetch('/api/paywall/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: target }),
        })
          .then(res => {
            if (!res.ok) console.error(`[paywall] intent write failed (${res.status})`)
          })
          .catch(err => console.error('[paywall] intent write failed', err))
        return
      }

      setPendingPlan(target)
      try {
        const res = await fetch('/api/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: target }),
        })
        const data = (await res.json().catch(() => ({}))) as { url?: unknown }

        if (res.ok && typeof data.url === 'string') {
          // Stripe owns the next screen. Deliberately not router.push: this is
          // a different origin, and the session must survive the round trip.
          window.location.assign(data.url)
          return
        }
        setError(apiErrorMessage(data, 'Could not open checkout. Nothing was charged.'))
      } catch {
        setError('Could not reach checkout. Nothing was charged — try again in a moment.')
      } finally {
        setPendingPlan(null)
      }
    },
    [billingLive, source],
  )

  if (!domReady) return null

  return createPortal(
    <div
      className="tb-plans-backdrop fixed inset-0 z-[8000] overflow-y-auto overscroll-none bg-background/80 p-2 backdrop-blur-xl supports-[backdrop-filter]:bg-background/30 sm:p-5"
      onMouseDown={e => {
        // Only a press that starts *and* stays on the backdrop closes it —
        // a drag that began inside the sheet must not dismiss it.
        if (e.target === e.currentTarget && !pendingPlan) handleClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sonicdesk plans"
        className="tb-plans-kit tb-plans-sheet font-body-tb mx-auto min-h-[calc(100vh-1rem)] w-full max-w-[1500px] border border-border bg-background text-foreground sm:min-h-[calc(100vh-2.5rem)]"
      >
        {confirmedPlan ? (
          <WaitlistConfirmation
            email={user?.email ?? null}
            planName={PLANS[confirmedPlan].name}
            onClose={handleClose}
          />
        ) : (
          <>
            <ModalHeader onClose={handleClose} closeDisabled={pendingPlan !== null} />

            {error && (
              <div className="border-b border-destructive/40 bg-destructive/[0.06] p-5 sm:px-8">
                <p className="m-0 flex items-start gap-2 text-sm leading-6 text-foreground">
                  <span className="mt-1 shrink-0 text-destructive">
                    <LucideIcon icon={CircleAlert} size={16} />
                  </span>
                  {error}
                </p>
              </div>
            )}

            <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
              {PLAN_ORDER.map(id => (
                <PlanCard
                  key={id}
                  id={id}
                  currentPlan={currentPlan}
                  pending={pendingPlan === id}
                  anyPending={pendingPlan !== null}
                  billingLive={billingLive}
                  onSubscribe={handleSubscribe}
                  onPointerEnter={e => handleCardPointerEnter(id, e)}
                  onPointerLeave={e => handleCardPointerLeave(id, e)}
                  onPointerDown={e => handleCardPointerDown(id, e)}
                />
              ))}
            </div>

            <ModalFooter source={source} billingLive={billingLive} />
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function ModalHeader({ onClose, closeDisabled }: { onClose: () => void; closeDisabled: boolean }) {
  return (
    <header className="relative border-b border-border p-5 sm:p-8">
      <button
        type="button"
        onClick={onClose}
        disabled={closeDisabled}
        aria-label="Close plans"
        className="absolute right-4 top-4 grid size-9 place-items-center text-foreground transition-colors hover:text-lime disabled:opacity-40"
      >
        <LucideIcon icon={X} size={18} />
      </button>

      <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="font-display-tb m-0 mt-3 max-w-4xl text-4xl font-semibold uppercase leading-[0.9] tracking-normal text-foreground sm:text-7xl">
            Pick the room your music needs
          </h2>
          <p className="m-0 mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            One person pays and everyone they invite gets the same tools. Nothing is ever deleted
            when a plan changes.
          </p>
        </div>

        <div className="flex h-9 items-end gap-1" aria-hidden>
          {EQ_BARS.map((bar, i) => (
            <span
              key={i}
              className="tb-eq-bar w-1 bg-lime opacity-70"
              style={{
                height: `${bar.heightPct}%`,
                ['--tb-eq-dur' as string]: `${bar.durationMs}ms`,
                ['--tb-eq-delay' as string]: `${bar.delayMs}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </header>
  )
}

// ── Footer ───────────────────────────────────────────────────────────────────

function ModalFooter({ source, billingLive }: { source: PaywallSource; billingLive: boolean }) {
  return (
    <footer className="flex flex-col justify-between gap-4 border-t border-border p-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:px-8">
      <a
        href="mailto:hi@sonicdesk.studio?subject=Studio%20plan"
        onClick={() => trackEvent('paywall_b2b_clicked', { source })}
        className="font-display-tb font-semibold uppercase text-foreground transition-colors hover:text-lime"
      >
        Working with multiple artists? Let&rsquo;s talk about a Studio plan
        <span className="ml-2 inline-block align-middle" aria-hidden>
          <LucideIcon icon={ArrowRight} size={16} />
        </span>
      </a>
      <span className="font-mono-tb text-[9px] uppercase tracking-widest">
        {billingLive
          ? 'Prices in USD · Cancel anytime · Taxes shown at checkout'
          : 'Prices in USD · Cancel anytime · Early supporters get first access'}
      </span>
    </footer>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

function PlanCard({
  id,
  currentPlan,
  pending,
  anyPending,
  billingLive,
  onSubscribe,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}: {
  id: PlanId
  currentPlan: PlanId
  pending: boolean
  anyPending: boolean
  billingLive: boolean
  onSubscribe: (plan: PaidPlanId) => void
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
  onPointerDown: (e: PointerEvent) => void
}) {
  const def = PLANS[id]
  const copy = PLAN_COPY[id]
  const isCurrent = id === currentPlan

  const rows = useMemo(() => planLimitRows(id), [id])
  const highlights = useMemo(() => planUpgradeHighlights(id), [id])
  const previousName = useMemo(() => {
    const index = PLAN_ORDER.indexOf(id)
    return index > 0 ? PLANS[PLAN_ORDER[index - 1]].name : null
  }, [id])

  return (
    <article
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      className={`tb-plans-card relative grid grid-rows-[auto_auto_auto_1fr_auto] border bg-surface p-5 hover:bg-card ${
        copy.featured ? 'border-lime' : 'border-border'
      }`}
    >
      {copy.featured && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-lime" aria-hidden />
          <StatusBadge tone="lime" className="justify-self-start">Recommended</StatusBadge>
        </>
      )}

      {/* Row 1 — plan square */}
      <div className="mb-4 mt-3 size-3" style={{ background: copy.color }} aria-hidden />

      {/* Row 2 — name and blurb */}
      <div>
        <h3 className="font-display-tb m-0 text-3xl font-semibold uppercase tracking-normal text-foreground">
          {def.name}
        </h3>
        {copy.blurb && (
          <p className="m-0 mt-2 min-h-14 text-sm leading-6 text-muted-foreground">{copy.blurb}</p>
        )}
      </div>

      {/* Row 3 — price, on a shared row across all cards */}
      <div className="my-5 border-y border-border py-5">
        <span className="font-display-tb text-4xl font-semibold text-foreground">{def.price}</span>
        <span className="text-xs text-muted-foreground"> / month</span>
      </div>

      {/* Row 4 — limits, features, caveats */}
      <div className="space-y-5">
        <div className="space-y-2">
          {rows.map(row => (
            <div key={row.label} className="flex justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-1.5 shrink-0" style={{ background: copy.color }} aria-hidden />
                {row.label}
              </span>
              <strong className="font-bold text-foreground">{row.value}</strong>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 font-mono-tb text-[9px] uppercase tracking-widest text-muted-foreground">
            {previousName ? `Everything in ${previousName}, plus:` : 'Included:'}
          </div>
          <ul className="m-0 list-none space-y-2 p-0">
            {(id === 'free' ? FREE_INCLUDED : highlights).map(line => (
              <li key={line} className="flex gap-2 text-xs leading-5 text-foreground">
                <span
                  className="grid size-4 shrink-0 place-items-center text-primary-foreground"
                  style={{ background: copy.color }}
                >
                  <LucideIcon icon={Check} size={11} strokeWidth={2.5} />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {id === 'free' && (
          <div>
            <div className="mb-2 font-mono-tb text-[9px] uppercase tracking-widest text-muted-foreground">
              Not included
            </div>
            <ul className="m-0 list-none space-y-2 p-0">
              {GATED_FEATURES.map(feature => (
                <li key={feature} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                  <span className="grid size-4 shrink-0 place-items-center border border-border">
                    <LucideIcon icon={X} size={10} strokeWidth={2} />
                  </span>
                  <span>{FEATURE_LABELS[feature]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Row 5 — CTA, pinned to the shared bottom row */}
      {isCurrent ? (
        <div className="mt-6 flex w-full select-none items-center justify-center border border-dashed border-border px-4 py-2.5 font-display-tb text-sm font-semibold uppercase text-muted-foreground">
          Current plan
        </div>
      ) : id === 'free' ? (
        <div className="mt-6 flex w-full select-none items-center justify-center border border-dashed border-border px-4 py-2.5 text-center font-display-tb text-sm font-semibold uppercase text-muted-foreground">
          Included with every account
        </div>
      ) : (
        <button
          type="button"
          disabled={anyPending}
          onClick={() => onSubscribe(id as PaidPlanId)}
          className={`mt-6 flex w-full items-center justify-center gap-2 px-4 py-2.5 font-display-tb text-sm font-semibold uppercase transition-colors disabled:opacity-60 ${
            copy.featured
              ? 'border border-lime bg-lime text-primary-foreground'
              : 'border border-border bg-foreground text-background'
          }`}
        >
          {pending && <Spinner size={13} tone="muted" />}
          {pending ? 'Opening checkout…' : billingLive ? 'Subscribe' : 'Join the waitlist'}
        </button>
      )}
    </article>
  )
}

// ── Waitlist confirmation ────────────────────────────────────────────────────

function WaitlistConfirmation({
  email,
  planName,
  onClose,
}: {
  email: string | null
  planName: string
  onClose: () => void
}) {
  return (
    <div className="grid min-h-[calc(100vh-2.5rem)] place-items-center p-6 text-center">
      <div className="max-w-xl">
        <Eyebrow>Waitlist confirmed</Eyebrow>
        <div className="relative mx-auto my-8 grid size-24 place-items-center border border-lime text-lime">
          <span className="absolute -left-3 -top-3 size-5 bg-lime" aria-hidden />
          <span className="absolute -bottom-3 -right-3 size-5 border border-lime" aria-hidden />
          <LucideIcon icon={Check} size={48} strokeWidth={2} />
        </div>
        <h2 className="font-display-tb m-0 text-5xl font-semibold uppercase leading-[0.9] tracking-normal text-foreground sm:text-7xl">
          You&rsquo;re on the list
        </h2>
        <p className="m-0 mt-5 text-sm leading-6 text-muted-foreground">
          Thanks for wanting {planName} out of Sonicdesk. We&rsquo;ll reach out as soon as this
          plan is available to buy — early supporters get first access.
        </p>
        <div className="mx-auto my-6 inline-block border border-border px-5 py-3 font-mono-tb text-sm text-foreground">
          {email ?? 'your email'}
        </div>
        <div>
          <button
            type="button"
            onClick={onClose}
            className="border border-lime bg-lime px-5 py-2.5 font-display-tb text-sm font-semibold uppercase text-primary-foreground"
          >
            Back to Sonicdesk
          </button>
        </div>
      </div>
    </div>
  )
}

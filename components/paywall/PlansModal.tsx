'use client'

/**
 * Plans modal — the landing page's (hidden) pricing section lifted into the
 * app: same card structure, typography scale, spacing rhythm, and featured
 * treatment, adapted to a bespoke full-frame modal shell (not the default
 * TbModal card).
 *
 * This is a measurement instrument. Subscribe writes an intent row and shows
 * a waitlist confirmation — no billing, no entitlements.
 *
 * GA4 gets behavior only: no email, user id, band or project names in params.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide'
import { useAuth } from '@/contexts/AuthContext'
import { trackEvent } from '@/lib/analytics'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { LucideIcon } from '@/components/design/LucideIcon'
import type { PaywallSource } from '@/contexts/PaywallContext'

type PaidPlanId = 'solo' | 'band' | 'band_plus'
type PlanId = 'free' | PaidPlanId

const HOVER_DWELL_THRESHOLD_MS = 500

/** Monotonic clock for duration measurements (event-handler-only usage). */
function nowMs() {
  return performance.now()
}

function emptySubscribe() {
  return () => {}
}

interface PlanDef {
  id: PlanId
  name: string
  price: string
  blurb: string | null
  color: string
  featured?: boolean
  limits: string[]
  featuresLabel: string
  features: string[]
  notIncluded?: string[]
}

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    blurb: null,
    color: 'var(--wave-mint)',
    limits: [
      '1 band',
      'Up to 3 members per band',
      '500 MB storage per band',
      'Up to 3 active versions per project',
    ],
    featuresLabel: 'Included:',
    features: [
      'Versioning (create versions, apply to Master)',
      'MIDI editor (piano roll)',
      'Song structure editor (manual chords, no auto-detect)',
      'Waveform comments with threads',
      'Band chat (per-project channels + band-wide)',
      'Resources (files, links, lyrics)',
      'Roadmap and checklist',
      'Recording',
      'Rehearsal Mode',
      'Individual stem download',
    ],
    notIncluded: [
      'A/B Compare',
      'Track editor',
      'Chord auto-detect',
      'Cherry-pick and visual version diff',
    ],
  },
  {
    id: 'solo',
    name: 'Solo',
    price: '$6',
    blurb: 'For independent musicians working alone or with one collaborator.',
    color: 'var(--wave-violet)',
    limits: [
      '1 band',
      'Up to 2 members per band',
      '10 GB storage per band',
      'Unlimited active versions',
    ],
    featuresLabel: 'Everything in Free, plus:',
    features: [
      'A/B Compare',
      'Track editor',
      'Chord auto-detect',
      'Cherry-pick and visual version diff',
    ],
  },
  {
    id: 'band',
    name: 'Band',
    price: '$9',
    blurb: 'For small bands actively working together.',
    color: 'var(--lime)',
    featured: true,
    limits: [
      '1 owned band',
      'Up to 3 bands as a member',
      'Unlimited members per band',
      '10 GB storage per band',
      'Unlimited active versions',
    ],
    featuresLabel: 'Everything in Solo, plus:',
    features: ['Unlimited band members'],
  },
  {
    id: 'band_plus',
    name: 'Band+',
    price: '$15',
    blurb: 'For active bands running multiple projects or several bands.',
    color: 'var(--wave-amber)',
    limits: [
      '5 owned bands',
      '5 bands as a member',
      'Unlimited members per band',
      '50 GB storage per band',
      'Unlimited active versions',
    ],
    featuresLabel: 'Everything in Band, plus:',
    features: ['50 GB storage per band'],
  },
]

// Decorative EQ strip for the header — precomputed so render stays pure.
const EQ_COLORS = ['var(--wave-mint)', 'var(--wave-violet)', 'var(--lime)', 'var(--wave-amber)']
const EQ_BARS = Array.from({ length: 28 }, (_, i) => ({
  height: 5 + Math.round(20 * Math.abs(Math.sin(i * 0.9) * Math.sin(i * 0.37))),
  color: EQ_COLORS[i % 4],
  opacity: i % 4 === 2 ? 0.9 : 0.4,
}))

export function PlansModal({
  source,
  onClose,
}: {
  source: PaywallSource
  onClose: () => void
}) {
  const { user } = useAuth()
  const [confirmedPlan, setConfirmedPlan] = useState<PaidPlanId | null>(null)

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
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  function handleCardPointerEnter(plan: PlanId, e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    lastEngagedPlanRef.current = plan
    hoverStartRef.current = { plan, t: nowMs() }
  }

  function handleCardPointerLeave(plan: PlanId, e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    const start = hoverStartRef.current
    hoverStartRef.current = null
    if (!start || start.plan !== plan) return
    const dwell = Math.round(nowMs() - start.t)
    // Below the threshold it's mouse travel, not interest — don't pollute the data.
    if (dwell > HOVER_DWELL_THRESHOLD_MS) {
      trackEvent('paywall_plan_viewed', { plan, dwell_ms: dwell })
    }
  }

  function handleCardPointerDown(plan: PlanId, e: PointerEvent) {
    lastEngagedPlanRef.current = plan
    // Hover doesn't exist on touch — a tap is the engagement signal there.
    if (e.pointerType === 'touch') {
      trackEvent('paywall_plan_viewed', { plan, dwell_ms: 0 })
    }
  }

  function handleSubscribe(plan: PaidPlanId) {
    trackEvent('paywall_subscribe_clicked', {
      plan,
      source,
      time_to_click_ms: Math.round(nowMs() - openTimeRef.current),
    })
    reachedRef.current = true
    // The confirmation is the UX contract; the row is our bookkeeping.
    // A failed write must never block or punish the user — log and move on.
    setConfirmedPlan(plan)
    void fetch('/api/paywall/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
      .then(res => {
        if (!res.ok) console.error(`[paywall] intent write failed (${res.status})`)
      })
      .catch(err => console.error('[paywall] intent write failed', err))
  }

  if (!domReady) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center overflow-y-auto overscroll-none bg-background/80 p-4 backdrop-blur-sm sm:p-6"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sonicdesk plans"
        onClick={e => e.stopPropagation()}
        className="relative my-auto flex max-h-[92vh] w-full max-w-[1200px] flex-col border border-border bg-background shadow-2xl"
      >
        {/* Accent hairline across the very top of the frame */}
        <div className="h-[3px] w-full shrink-0 bg-lime" aria-hidden />

        {confirmedPlan ? (
          /* ── Confirmation state ──────────────────────────────────────────── */
          <div className="flex flex-col items-center px-6 py-16 text-center sm:px-10 sm:py-20">
            <p className="font-mono-tb m-0 text-[9px] uppercase tracking-[0.26em] text-lime">
              Waitlist confirmed
            </p>
            <div className="relative mt-7 mb-8">
              <div className="grid size-14 place-items-center bg-lime text-primary-foreground">
                <LucideIcon icon={Check} size={26} />
              </div>
              <span className="absolute -right-1.5 -top-1.5 size-3 bg-lime/40" aria-hidden />
              <span className="absolute -bottom-1.5 -left-1.5 size-3 bg-lime/40" aria-hidden />
            </div>
            <h2 className="font-display-tb m-0 text-3xl font-bold uppercase tracking-tight text-foreground">
              You&rsquo;re on the list
            </h2>
            <p className="font-mono-tb m-0 mt-5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              Thanks for wanting more out of Sonicdesk. We&rsquo;ll reach out to{' '}
              <span className="border border-border bg-surface px-1.5 py-0.5 text-foreground">
                {user?.email ?? 'your email'}
              </span>{' '}
              as soon as this plan is available to buy — early supporters get first access.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="tb-btn-accent group/btn mt-10 inline-flex items-center gap-3 border border-lime bg-lime px-6 py-3 text-[11px] uppercase text-primary-foreground"
            >
              <span>Back to Sonicdesk</span>
              <span className="transition-transform duration-200 group-hover/btn:translate-x-1" aria-hidden>
                →
              </span>
            </button>
          </div>
        ) : (
          <>
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="relative flex shrink-0 items-start justify-between gap-4 overflow-hidden border-b border-border px-6 pb-5 pt-5 sm:px-8">
              <div className="min-w-0">
                <p className="font-mono-tb m-0 flex items-center gap-2 text-[9px] uppercase tracking-[0.26em] text-lime">
                  <span className="size-1.5 bg-lime" aria-hidden />
                  Pricing
                </p>
                <h2 className="font-display-tb m-0 mt-2 text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl">
                  Get more out of Sonicdesk
                </h2>
                <p className="font-mono-tb m-0 mt-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  One surface for the whole band — pick the room that fits
                </p>
              </div>

              {/* EQ motif rising from the header's bottom border */}
              <div
                className="pointer-events-none absolute bottom-0 right-24 hidden items-end gap-[3px] md:flex"
                aria-hidden
              >
                {EQ_BARS.map((bar, i) => (
                  <span
                    key={i}
                    className="w-[3px]"
                    style={{ height: bar.height, background: bar.color, opacity: bar.opacity }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleClose}
                aria-label="Close plans"
                className="grid size-9 shrink-0 place-items-center border border-border text-muted-foreground transition-colors hover:border-lime hover:text-lime"
              >
                <LucideIcon icon={X} size={16} />
              </button>
            </div>

            {/* ── Cards ───────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
              <div className="grid auto-rows-auto gap-px border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--border)_80%,transparent)] sm:grid-cols-2 xl:grid-cols-4">
                {PLANS.map(p => (
                  <div
                    key={p.id}
                    onPointerEnter={e => handleCardPointerEnter(p.id, e)}
                    onPointerLeave={e => handleCardPointerLeave(p.id, e)}
                    onPointerDown={e => handleCardPointerDown(p.id, e)}
                    onFocusCapture={() => {
                      lastEngagedPlanRef.current = p.id
                    }}
                    className={`relative row-span-5 grid grid-rows-subgrid transition-colors ${
                      p.featured ? 'bg-card' : 'bg-background hover:bg-card'
                    }`}
                  >
                    {p.featured && (
                      <>
                        <div
                          className="pointer-events-none absolute inset-0 z-10 border border-lime"
                          aria-hidden
                        />
                        <div
                          className="pointer-events-none absolute -top-px left-0 right-0 z-10 h-[3px] bg-lime"
                          aria-hidden
                        />
                      </>
                    )}

                    {/* Row 1 — plan name */}
                    <div className="flex items-start justify-between gap-2 px-6 pt-6">
                      <div className="flex items-center gap-2.5">
                        <span className="size-3 shrink-0" style={{ background: p.color }} />
                        <h3 className="font-display-tb m-0 text-[22px] font-bold uppercase tracking-tight text-foreground">
                          {p.name}
                        </h3>
                      </div>
                      {p.featured && (
                        <span className="font-mono-tb mt-1 shrink-0 bg-lime px-1.5 py-1 text-[8px] uppercase leading-none tracking-[0.2em] text-primary-foreground">
                          Recommended
                        </span>
                      )}
                    </div>

                    {/* Row 2 — blurb (empty row still aligns prices across cards) */}
                    <div className="px-6 pt-2">
                      {p.blurb && (
                        <p className="font-mono-tb m-0 text-[11px] leading-relaxed text-muted-foreground">
                          {p.blurb}
                        </p>
                      )}
                    </div>

                    {/* Row 3 — price, on a shared row across all cards */}
                    <div className="px-6 pt-5">
                      <div className="flex items-baseline gap-2 border-y border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-4">
                        <span className="font-display-tb text-5xl font-bold tracking-tight text-foreground">
                          {p.price}
                        </span>
                        <span className="font-mono-tb text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          / month
                        </span>
                      </div>
                    </div>

                    {/* Row 4 — limits + features */}
                    <div className="px-6 pb-2 pt-4">
                      <ul className="m-0 list-none space-y-1.5 p-0">
                        {p.limits.map(l => (
                          <li
                            key={l}
                            className="font-mono-tb flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground"
                          >
                            <span className="mt-[7px] size-1 shrink-0" style={{ background: p.color }} />
                            <span>{l}</span>
                          </li>
                        ))}
                      </ul>

                      <p className="font-mono-tb m-0 mt-5 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                        {p.featuresLabel}
                      </p>
                      <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
                        {p.features.map(f => (
                          <li
                            key={f}
                            className="font-mono-tb flex items-start gap-2.5 text-[11px] leading-relaxed text-foreground"
                          >
                            <span
                              className="mt-[2px] grid size-4 shrink-0 place-items-center text-primary-foreground"
                              style={{ background: p.color }}
                            >
                              <CheckGlyph />
                            </span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>

                      {p.notIncluded && (
                        <>
                          <p className="font-mono-tb m-0 mt-5 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                            Not included:
                          </p>
                          <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
                            {p.notIncluded.map(f => (
                              <li
                                key={f}
                                className="font-mono-tb flex items-start gap-2.5 text-[11px] leading-relaxed text-muted-foreground"
                              >
                                <span className="mt-[2px] grid size-4 shrink-0 place-items-center border border-border">
                                  <XGlyph />
                                </span>
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>

                    {/* Row 5 — CTA, pinned to the shared bottom row */}
                    <div className="flex items-end px-6 pb-6 pt-4">
                      {p.id === 'free' ? (
                        <div className="font-mono-tb flex w-full select-none items-center justify-center border border-dashed border-border px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                          Current plan
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSubscribe(p.id as PaidPlanId)}
                          className={`group/btn relative z-20 flex w-full items-center justify-between border px-4 py-3 text-[11px] uppercase ${
                            p.featured
                              ? 'tb-btn-accent border-lime bg-lime text-primary-foreground'
                              : 'font-mono-tb tracking-[0.22em] border-[color-mix(in_oklab,var(--foreground)_40%,transparent)] text-foreground transition-colors hover:border-lime hover:text-lime'
                          }`}
                        >
                          <span>Subscribe</span>
                          <span
                            className="transition-transform duration-200 group-hover/btn:translate-x-1"
                            aria-hidden
                          >
                            →
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Footer strip: B2B line + microcopy ──────────────────────── */}
            <div className="flex shrink-0 flex-col items-center justify-between gap-2 border-t border-border px-6 py-3.5 sm:flex-row sm:px-8">
              <a
                href="mailto:hi@sonicdesk.studio?subject=Studio%20plan"
                onClick={() => trackEvent('paywall_b2b_clicked', { source })}
                className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground underline-offset-4 transition-colors hover:text-lime hover:underline"
              >
                Working with multiple artists? Let&rsquo;s talk about a Studio plan →
              </a>
              <p className="font-mono-tb m-0 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
                Prices in USD · Cancel anytime · Early supporters get first access
              </p>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

function CheckGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2 6.5L4.8 9.2 10 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function XGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

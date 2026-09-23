'use client'

/**
 * Billing — the one screen that talks about money.
 *
 * Built from the subscription design kit ("Billing settings", "Plan
 * lifecycle", "Payment recovery"), with one deliberate departure: the card
 * form, the invoice table and the tax-id form the kit draws are not built
 * here. Stripe's customer portal already renders all three, keeps them
 * compliant and localised, and — more to the point — owns the data. A second
 * invoice list of our own would be a copy that can disagree with the real one,
 * and the copy is always the one a user is looking at when it does.
 *
 * So this page answers the questions Stripe cannot: what the plan means for
 * your bands, what a change will do to them, and what is still yours if a
 * payment fails. Everything transactional is one button away, in the portal.
 *
 * Nothing on this page grants anything. Plans come from `GET /api/me/plan`,
 * which resolves them server-side from the database; the billing details come
 * from `GET /api/me/billing` and are display copy in the strictest sense.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowRight, ChevronDown, CircleAlert, CircleCheck, ExternalLink,
  HardDrive, Layers3, Users,
} from 'lucide'
import { AppHeader } from '@/components/design/AppShell'
import { LucideIcon } from '@/components/design/LucideIcon'
import {
  Eyebrow, InlineNotice, StatusBadge, TONE, UsageBar, usageFraction, usageTone,
  actionDestructive, actionOutlineTall, actionPrimaryTall, NEAR_LIMIT_FRACTION,
  type PlanTone,
} from '@/components/plan/ui'
import { GraceBanner } from '@/components/plan/GraceBanner'
import { FrozenBandChip } from '@/components/plan/FrozenBandBanner'
import { AddonRows } from '@/components/billing/AddonRows'
import {
  formatDate,
  formatMoney,
  type BillingView,
  type UpcomingInvoiceView,
} from '@/components/billing/types'
import { usePaywall, usePlanTracking } from '@/contexts/PaywallContext'
import { apiErrorMessage } from '@/lib/planCopy'
import { formatCatalogPrice, formatInterval } from '@/lib/planPrices'
import { formatStorageLimit } from '@/lib/bandStorage'
import { PLANS, isPlanId, type Limit, type PlanId } from '@/lib/plans'

/** How Stripe's statuses read to a person, and how alarmed to look about them. */
const STATUS_COPY: Record<string, { label: string; tone: PlanTone }> = {
  trialing: { label: 'Trial', tone: 'lime' },
  active: { label: 'Active', tone: 'lime' },
  past_due: { label: 'Payment failing', tone: 'amber' },
  unpaid: { label: 'Unpaid', tone: 'destructive' },
  incomplete: { label: 'Awaiting payment', tone: 'amber' },
  incomplete_expired: { label: 'Expired', tone: 'destructive' },
  canceled: { label: 'Cancelled', tone: 'destructive' },
  paused: { label: 'Paused', tone: 'amber' },
}

/**
 * How long to keep asking after a return from Stripe, and how patiently.
 *
 * A webhook is usually processed before the browser finishes redirecting, but
 * "usually" is doing real work there: Stripe retries, our handler claims the
 * event, `changePlan` settles bands. Backing off rather than hammering costs
 * nothing when it is fast and still covers the slow case — roughly 30 seconds
 * in five requests.
 *
 * The portal gets a shorter version. There is nothing specific to wait for
 * (see `PORTAL_POLL_DELAYS_MS` at the call site), so this is a refresh with a
 * couple of retries, not a wait for a value.
 */
const CHECKOUT_POLL_DELAYS_MS = [1000, 2000, 4000, 8000, 15000]
const PORTAL_POLL_DELAYS_MS = [1000, 2000, 4000]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function BillingClient() {
  const params = useSearchParams()
  const checkoutResult = params.get('checkout')
  const planParam = params.get('plan')
  // What checkout was FOR. Absent on an older success URL still in a history
  // entry, in which case the poll falls back to "anything but free".
  const targetPlan: PlanId | null = isPlanId(planParam) && planParam !== 'free' ? planParam : null
  const returnedFromPortal = params.get('portal') === 'return'
  const confirmMode: 'checkout' | 'portal' | null =
    checkoutResult === 'success' ? 'checkout' : returnedFromPortal ? 'portal' : null

  const { snapshot: plan, openPaywall, refresh } = usePaywall()
  const track = usePlanTracking()
  const [billing, setBilling] = useState<BillingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')
  const [usageOpen, setUsageOpen] = useState(false)
  // Set on the very first render, not from an effect: between mount and the
  // first poll the snapshot still says `free`, and a frame of the OLD plan
  // rendered as current is exactly what this item exists to remove.
  const [upcoming, setUpcoming] = useState<UpcomingInvoiceView | null>(null)
  const [confirming, setConfirming] = useState<'checkout' | 'portal' | null>(confirmMode)
  const [confirmTimedOut, setConfirmTimedOut] = useState(false)

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/me/billing')
      if (!res.ok) throw new Error(String(res.status))
      setBilling((await res.json()) as BillingView)
    } catch {
      // A failed read here must never look like "you have no subscription":
      // leave whatever we had and say nothing rather than imply a cancellation.
      console.error('[billing] could not load billing details')
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * The next invoice, previewed by Stripe.
   *
   * Separate from `loadBilling` because it costs a live Stripe round trip
   * where that one reads the local mirror, and because it has to be re-read
   * after an add-on changes — a total that still shows the pre-change figure
   * is worse than no total. A failure leaves the footer without a number
   * rather than taking the screen down: `upcoming` stays null and the footer
   * falls back to the plan's sticker price.
   */
  const loadUpcoming = useCallback(async () => {
    try {
      const res = await fetch('/api/me/billing/upcoming')
      if (!res.ok) throw new Error(String(res.status))
      setUpcoming((await res.json()) as UpcomingInvoiceView)
    } catch {
      console.error('[billing] could not preview the next invoice')
      setUpcoming(null)
    }
  }, [])

  useEffect(() => {
    void loadBilling()
    void loadUpcoming()
  }, [loadBilling, loadUpcoming])

  // ── Returning from Stripe ────────────────────────────────────────────────
  //
  // This used to be one `refresh()` on a 2.5 s timer. If the webhook had not
  // landed by then — and nothing guarantees it has — the user came back from a
  // paid card to a page showing `free`, with nothing on it to say that anything
  // was pending and no second attempt.
  //
  // So: poll with backoff until the plan is the one that was bought, and say
  // plainly what is happening until it is. `refresh()` is the request, which
  // means each poll also invalidates the shared `PaywallContext` snapshot —
  // that is what unlocks `ab_compare` and `chord_detect` in this tab without a
  // reload, since for those two the snapshot is the only gate there is.
  //
  // The portal branch polls for a refresh, NOT for a value: a change made in
  // the portal may be scheduled for period end, so "nothing moved" is a
  // correct outcome and must not be reported as a timeout.
  useEffect(() => {
    if (!confirmMode) return
    let cancelled = false

    void (async () => {
      const delays = confirmMode === 'checkout' ? CHECKOUT_POLL_DELAYS_MS : PORTAL_POLL_DELAYS_MS

      // Ask once with no delay first. The webhook usually lands before the
      // browser finishes the redirect, and this is also what keeps a RELOAD of
      // an already-settled `?checkout=success` URL from showing "confirming"
      // for a second over a plan that is already correct.
      const first = await refresh()
      if (cancelled) return
      if (
        confirmMode === 'checkout' &&
        first &&
        (targetPlan ? first.plan === targetPlan : first.plan !== 'free')
      ) {
        setConfirming(null)
        void loadBilling()
        return
      }

      for (const delay of delays) {
        await sleep(delay)
        if (cancelled) return

        const next = await refresh()
        if (cancelled) return
        await loadBilling()
        if (cancelled) return

        if (confirmMode !== 'checkout' || !next) continue
        // With a target plan the test is exact. Without one (a success URL
        // from before the plan was carried) "no longer free" is the most that
        // can be said, and it is still better than a fixed timer.
        const arrived = targetPlan ? next.plan === targetPlan : next.plan !== 'free'
        if (arrived) {
          setConfirming(null)
          return
        }
      }

      if (cancelled) return
      setConfirming(null)
      // Only checkout has something to apologise for: money moved and the
      // confirmation has not arrived. Never fall back to showing the old plan
      // as if it were the answer.
      if (confirmMode === 'checkout') setConfirmTimedOut(true)
    })()

    return () => {
      cancelled = true
    }
  }, [confirmMode, targetPlan, refresh, loadBilling])

  const openPortal = useCallback(async () => {
    setPortalBusy(true)
    setError('')
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { url?: unknown }
      if (res.ok && typeof data.url === 'string') {
        window.location.assign(data.url)
        return
      }
      setError(apiErrorMessage(data, 'Could not open the billing portal'))
    } catch {
      setError('Could not reach the billing portal. Nothing was changed.')
    } finally {
      setPortalBusy(false)
    }
  }, [])

  const subscription = billing?.subscription ?? null
  const billingLive = billing?.billingLive ?? plan.billingLive
  const status = subscription ? (STATUS_COPY[subscription.status] ?? {
    label: subscription.status,
    tone: 'amber' as PlanTone,
  }) : null
  const def = PLANS[plan.plan]
  // Stripe's price for the current plan (null when Stripe could not be read).
  const planPrice = formatCatalogPrice(plan.prices.plans[plan.plan])

  // ── Usage headlines ───────────────────────────────────────────────────────
  //
  // The three figures the `/subscription` design leads with. Every one is a
  // ceiling the user can actually meet, and each is read straight off the
  // resolved snapshot — the limits already include add-ons and any override by
  // the time they arrive here.
  const bands = plan.usage.bands
  const topStorage = bands.reduce((max, b) => Math.max(max, b.storageBytes), 0)
  const topMembers = bands.reduce((max, b) => Math.max(max, b.memberCount), 0)
  const storageAddonBands = new Set(
    plan.addons.filter(a => a.type === 'extra_storage' && a.bandId).map(a => a.bandId as string),
  )

  // The kit's usage heading is a verdict ("Plenty of room left"), not a label,
  // so it has to be earned from the same three figures the tiles show. A
  // headline that says "plenty" over a full bar is worse than no headline.
  const worstFraction = Math.max(
    usageFraction(plan.usage.bandsOwned, plan.limits.bandsOwned) ?? 0,
    usageFraction(topStorage, plan.limits.storagePerBandBytes) ?? 0,
    usageFraction(topMembers, plan.limits.membersPerBand) ?? 0,
  )
  const usageHeadline =
    worstFraction >= 1
      ? "You've reached a limit"
      : worstFraction >= NEAR_LIMIT_FRACTION
        ? 'Getting close to a limit'
        : 'Plenty of room left'

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader crumbs={<span className="text-foreground">Billing</span>} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <header className="mb-10 grid gap-5 border-b border-border pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <Eyebrow>Plan &amp; billing</Eyebrow>
            <h1 className="font-display-tb m-0 mt-4 text-5xl uppercase leading-[.88] tracking-normal! sm:text-7xl">
              Your plan,
              <br />
              at a glance.
            </h1>
          </div>
          <p className="font-body-tb m-0 max-w-md text-sm leading-6 text-muted-foreground">
            See what you have, what you use, and what changes your monthly total. Nothing else
            competes for attention.
          </p>
        </header>

        {/* ── Return from checkout ──────────────────────────────────────── */}
        {confirming === 'checkout' && (
          <InlineNotice
            className="mb-8"
            tone="lime"
            title="Confirming your payment…"
            detail="Stripe has your payment. We are waiting for it to be confirmed — usually a few seconds. Nothing is needed from you and this page updates itself."
          />
        )}
        {confirmTimedOut && (
          <InlineNotice
            className="mb-8"
            tone="amber"
            title="Payment received — your plan will update shortly"
            detail="The confirmation from Stripe has not reached us yet. Your payment went through and nothing is needed from you; the plan below updates as soon as it lands."
          />
        )}
        {confirming === 'portal' && (
          <InlineNotice
            className="mb-8"
            tone="mint"
            title="Checking for changes…"
            detail="Re-reading your subscription. A change you scheduled for the end of the period will show on its renewal date rather than now."
          />
        )}
        {checkoutResult === 'cancelled' && (
          <InlineNotice
            className="mb-8"
            tone="amber"
            title="Checkout closed"
            detail="Nothing was charged and nothing changed. You can pick a plan again whenever you like."
          />
        )}
        {error && <InlineNotice className="mb-8" title={error} />}

        {/* ── Payment recovery ──────────────────────────────────────────── */}
        {subscription?.paymentFailedAt && (
          <section className="mb-8 border border-destructive/40 bg-destructive/[0.06] p-5 text-destructive">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 grow basis-72 gap-3">
                <span className="mt-0.5 shrink-0">
                  <LucideIcon icon={CircleAlert} size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display-tb m-0 text-xl uppercase tracking-normal!">
                    We couldn&rsquo;t take the last payment
                  </h2>
                  <p className="font-body-tb m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Everything keeps working while Stripe retries
                    {subscription.nextPaymentAttempt
                      ? ` — the next attempt is ${formatDate(subscription.nextPaymentAttempt)}`
                      : ''}
                    . Update the card and the retry usually clears it straight away. If the
                    retries run out, the plan ends and spaces over the limit go read-only —
                    nothing is deleted even then.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className={actionDestructive}
                onClick={() => {
                  track('billing_portal_opened', { source: 'payment_failed' })
                  void openPortal()
                }}
                disabled={portalBusy}
              >
                {portalBusy ? 'Opening…' : 'Update payment method'}
              </button>
            </div>
          </section>
        )}

        <GraceBanner className="mb-8" />

        {/* ── Current plan ──────────────────────────────────────────────── */}
        <section className="grid border border-border bg-surface lg:grid-cols-[1fr_auto]">
          <div className="p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>Current plan</Eyebrow>
              {confirming === 'checkout' ? (
                <StatusBadge tone="amber">Confirming</StatusBadge>
              ) : status ? (
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              ) : (
                plan.plan === 'free' && <StatusBadge tone="mint">Free plan</StatusBadge>
              )}
            </div>

            {/*
              While a payment is being confirmed the snapshot still holds the
              plan the user had BEFORE paying. Rendering it here would be the
              page telling them, in its most authoritative spot, that they are
              on the plan they just paid to leave. So this names what was
              bought and marks it pending instead.
            */}
            <div className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-2">
              <h2 className="font-display-tb m-0 text-5xl uppercase leading-none tracking-normal! sm:text-6xl">
                {confirming === 'checkout'
                  ? targetPlan
                    ? PLANS[targetPlan].name
                    : 'Your new plan'
                  : def.name}
              </h2>
              {confirming !== 'checkout' && planPrice && (
                <div className="pb-1">
                  <strong className="font-display-tb text-2xl tracking-normal!">{planPrice}</strong>
                  <span className="font-body-tb text-sm text-muted-foreground">
                    {' '}
                    / {formatInterval(plan.prices.plans[plan.plan])}
                  </span>
                </div>
              )}
            </div>

            <p className="font-body-tb m-0 mt-3 text-sm text-muted-foreground">
              {confirming === 'checkout' ? (
                'Paid — waiting for Stripe to confirm it'
              ) : subscription?.currentPeriodEnd ? (
                <>
                  {subscription.cancelAtPeriodEnd ? 'Ends' : 'Next payment'}:{' '}
                  {formatDate(subscription.currentPeriodEnd)}
                </>
              ) : (
                'No renewal date — nothing is being charged'
              )}
            </p>
          </div>

          <div className="flex min-w-64 flex-col justify-center gap-2 border-t border-border p-6 lg:border-l lg:border-t-0">
            <button
              type="button"
              className={actionPrimaryTall}
              onClick={() => {
                track('plan_change_clicked', {
                  source: 'billing',
                  intent: plan.plan === 'free' ? 'choose' : 'change',
                })
                openPaywall('preferences')
              }}
            >
              {plan.plan === 'free' ? 'Choose a plan' : 'Change plan'}
              <LucideIcon icon={ArrowRight} size={15} />
            </button>

            {billing?.hasBillingAccount && (
              <button
                type="button"
                className={actionOutlineTall}
                onClick={() => {
                  track('billing_portal_opened', { source: 'billing' })
                  void openPortal()
                }}
                disabled={portalBusy}
              >
                {portalBusy ? 'Opening…' : 'Manage billing'}
                <LucideIcon icon={ExternalLink} size={13} />
              </button>
            )}
          </div>
        </section>

        {subscription?.cancelAtPeriodEnd && (
          <InlineNotice
            className="mt-4"
            tone="amber"
            title={`Your subscription ends ${formatDate(subscription.currentPeriodEnd)}`}
            detail="Everything works normally until then. Reactivate before that date and nothing changes at all — after it, spaces over the free limit become read-only and nothing is deleted."
          />
        )}

        <p className="font-body-tb m-0 mt-3 text-xs leading-5 text-muted-foreground">
          {billing?.hasBillingAccount
            ? 'Your card, billing address, VAT details, invoices, cancellation and reactivation all live in the Stripe portal — the same place the receipts come from.'
            : billingLive
              ? 'You have not paid for anything yet, so there is nothing to manage. Picking a plan sets that up.'
              : 'Checkout is not open yet. Picking a plan puts you on the list, and we will write to you when it is.'}
        </p>

        {/* ── Usage ─────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <Eyebrow>Usage</Eyebrow>
              <h2 className="font-display-tb m-0 mt-2 text-3xl uppercase tracking-normal! text-foreground">
                {usageHeadline}
              </h2>
            </div>
            <span className="font-mono-tb hidden text-[9px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
              Live allowance
            </span>
          </div>

          <div className="grid gap-px border border-border bg-border md:grid-cols-3">
            <UsageSummary
              icon={Layers3}
              label="Spaces you own"
              current={plan.usage.bandsOwned}
              limit={plan.limits.bandsOwned}
            />
            <UsageSummary
              icon={HardDrive}
              label="Highest storage"
              current={topStorage}
              limit={plan.limits.storagePerBandBytes}
              render={formatStorageLimit}
            />
            <UsageSummary
              icon={Users}
              label="Largest space"
              current={topMembers}
              limit={plan.limits.membersPerBand}
            />
          </div>

          {/* The override is a FLOOR, so it is only worth naming when it is the
              number actually in force — see the same rule in PlanUsage. */}
          {plan.bandsOwnedOverridden && (
            <p className="font-body-tb m-0 mt-3 border-l-2 border-wave-violet pl-3 text-xs leading-5 text-muted-foreground">
              Your account has a guaranteed minimum allowance of owned spaces, on top of whatever
              your plan grants.
            </p>
          )}

          {bands.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  track('plan_usage_toggled', { open: !usageOpen })
                  setUsageOpen(v => !v)
                }}
                aria-expanded={usageOpen}
                className="font-body-tb mt-2 flex h-10 w-full items-center justify-between border-b border-border text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {usageOpen ? 'Hide space details' : 'Show usage by space'}
                <LucideIcon
                  icon={ChevronDown}
                  size={14}
                  className={`transition-transform ${usageOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {usageOpen && (
                <div className="divide-y divide-border border-x border-b border-border">
                  {bands.map(band => (
                    <div
                      key={band.id}
                      className="grid gap-4 p-4 sm:grid-cols-[1fr_130px_1fr] sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <strong className="font-body-tb truncate text-sm font-medium text-foreground">
                          {band.name}
                        </strong>
                        {band.frozen && <FrozenBandChip />}
                      </div>
                      <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                        {band.memberCount}{' '}
                        {band.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      <UsageBar
                        label={
                          storageAddonBands.has(band.id) ? (
                            <>
                              Storage <span className="text-lime">+ add-on</span>
                            </>
                          ) : (
                            'Storage'
                          )
                        }
                        current={band.storageBytes}
                        limit={plan.limits.storagePerBandBytes}
                        render={formatStorageLimit}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ── What a change does ────────────────────────────────────────── */}
        <section className="mt-10 grid gap-3 md:grid-cols-3">
          <LifecycleNote
            title="Upgrading"
            body="New limits switch on as soon as the payment clears, and any space frozen for being over the old limit comes back immediately — nothing to restore."
          />
          <LifecycleNote
            title="Downgrading"
            body="Takes effect at once and never asks you to justify it. Features lock, and if your data is over the new limits you get 14 days before anything goes read-only."
          />
          <LifecycleNote
            title="Cancelling"
            body="Your paid access runs to the end of the period you already paid for. After that you are on Free, with every file, comment and version still here."
          />
        </section>

        {/* ── Add-ons ───────────────────────────────────────────────────── */}
        <div className="mt-14">
          <AddonRows
            canBuy={billingLive && !loading && subscription !== null && subscription.entitling}
            // The footer breakdown is Stripe's preview, so it is stale the
            // moment an add-on lands or is scheduled to end. Re-read it.
            onChanged={loadUpcoming}
            // Offered after a declined card: the card lives in the portal.
            onUpdatePaymentMethod={() => {
              track('billing_portal_opened', { source: 'addon_declined' })
              void openPortal()
            }}
          />
        </div>

        {/*
          The design closes on an "estimated monthly total". This closes on the
          real one.

          Not by adding up the price strings — `lib/plans.ts` is explicit that
          nothing parses those, and a sum computed in the browser would be a
          second source of truth for money standing next to the invoice. It
          asks Stripe instead: `GET /api/me/billing/upcoming` previews the
          invoice it would issue right now, prorations, credits and tax
          included. Nothing here does arithmetic; `formatMoney` only puts
          Stripe's own integer into the user's locale.

          When there is no next invoice — free plan, no card, a subscription
          ending at period end — the footer falls back to the plan's sticker
          price, which is the honest thing to show when nothing is scheduled.
        */}
        <footer className="mt-8 border-t border-border pt-6">
          {upcoming?.available ? (
            <UpcomingInvoice upcoming={upcoming} />
          ) : (
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  Billed every {formatInterval(plan.prices.plans[plan.plan])}
                </span>
                <div className="font-display-tb mt-1 text-3xl tracking-normal! text-foreground">
                  {planPrice ?? '—'}
                  <span className="font-body-tb ml-2 text-xs font-normal text-muted-foreground">
                    + any add-ons
                  </span>
                </div>
              </div>
              <p className="font-body-tb m-0 flex items-center gap-2 text-xs text-muted-foreground">
                <LucideIcon icon={CircleCheck} size={14} className="text-lime" />
                {plan.prices.plans[plan.plan]
                  ? `Prices in ${plan.prices.plans[plan.plan]!.currency.toUpperCase()} · cancel anytime`
                  : 'Cancel anytime'}{' '}
                · the exact charge is on your Stripe invoice.
              </p>
            </div>
          )}
        </footer>
      </main>
    </div>
  )
}

/** One headline ceiling, in the `/subscription` tile shape. */
function UsageSummary({
  icon,
  label,
  current,
  limit,
  render,
}: {
  icon: Parameters<typeof LucideIcon>[0]['icon']
  label: string
  current: number
  limit: Limit
  render?: (value: number) => string
}) {
  const show = render ?? ((value: number) => String(value))
  const fraction = usageFraction(current, limit)
  const tone = usageTone(current, limit)

  return (
    // OPAQUE, and that is load-bearing. The grid behind these tiles is filled
    // with `bg-border` so the 1px gaps read as hairlines; a translucent face
    // lets that line colour through the whole tile, which is how the row came
    // out as one grey slab with invisible separators.
    <div className="bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2 text-lime">
        <LucideIcon icon={icon} size={14} />
        <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      </div>
      {/* The kit does not mute the ceiling: "4 / 10" is one figure read as a
          whole, and greying half of it makes the tile look half-loaded. */}
      <div className="font-display-tb mt-5 text-2xl uppercase tracking-normal! text-foreground">
        {show(current)} / {limit === null ? 'Unlimited' : show(limit)}
      </div>
      <div className="mt-4 h-[3px] w-full bg-surface-2">
        {fraction !== null && (
          <div
            className={`h-full transition-[width] duration-700 ease-out ${TONE[tone].fill}`}
            style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }}
          />
        )}
      </div>
    </div>
  )
}

function LifecycleNote({ title, body }: { title: string; body: string }) {
  return (
    <article className="border border-border bg-surface p-5">
      <h3 className="font-display-tb m-0 flex items-center gap-2 text-base uppercase tracking-normal! text-foreground">
        <LucideIcon icon={ArrowRight} size={13} className="text-lime" />
        {title}
      </h3>
      <p className="font-body-tb m-0 mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  )
}

/**
 * The next invoice, as Stripe previews it — as a breakdown, not one number.
 *
 * Add-ons are charged when they are added, so the renewal holds only
 * recurring amounts: the plan, then each add-on that renews. Add-ons
 * scheduled to end are no longer on the subscription and cannot appear.
 * Anything else Stripe will put on the invoice — a proration left over from
 * a change made before add-ons were charged up front, a one-off item — is
 * listed in its own group under "Adjustments" rather than merged silently
 * into the total. Every figure is Stripe's; `formatMoney` only localises it.
 */
function UpcomingInvoice({ upcoming }: { upcoming: Extract<UpcomingInvoiceView, { available: true }> }) {
  const credit = upcoming.startingBalance < 0 && upcoming.amountDue !== upcoming.total
    ? upcoming.total - upcoming.amountDue
    : 0
  const money = (amount: number) => formatMoney(amount, upcoming.currency)

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            {upcoming.dueAt ? `Next invoice · ${formatDate(upcoming.dueAt)}` : 'Next invoice'}
          </span>
          <div className="font-display-tb mt-1 text-3xl tracking-normal! text-foreground">
            {money(upcoming.amountDue)}
          </div>
        </div>
        <p className="font-body-tb m-0 flex items-center gap-2 text-xs text-muted-foreground">
          <LucideIcon icon={CircleCheck} size={14} className="text-lime" />
          Previewed by Stripe · add-ons ending before this date are not included
        </p>
      </div>

      <dl className="font-body-tb m-0 mt-5 grid gap-2 border-t border-border pt-4 text-xs leading-5">
        {upcoming.plan && (
          <InvoiceRow label={`${upcoming.plan.description} plan`} amount={money(upcoming.plan.amount)} />
        )}
        {upcoming.addons.map(addon => (
          <InvoiceRow
            key={addon.type}
            label={`${addon.name}${addon.quantity > 1 ? ` × ${addon.quantity}` : ''}`}
            amount={money(addon.amount)}
          />
        ))}

        {upcoming.adjustments.length > 0 && (
          <>
            <dt className="font-mono-tb mt-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Adjustments from earlier changes
            </dt>
            {upcoming.adjustments.map((line, i) => (
              <InvoiceRow key={`${line.description}-${i}`} label={line.description} amount={money(line.amount)} muted />
            ))}
          </>
        )}

        {upcoming.discount > 0 && <InvoiceRow label="Discount" amount={money(-upcoming.discount)} muted />}
        {upcoming.tax > 0 && <InvoiceRow label="Tax" amount={money(upcoming.tax)} muted />}
        {credit > 0 && <InvoiceRow label="Account credit" amount={money(-credit)} muted />}

        <div className="mt-2 grid grid-cols-[1fr_auto] gap-4 border-t border-border pt-3">
          <dt className="text-foreground">Total due</dt>
          <dd className="font-mono-tb m-0 text-foreground">{money(upcoming.amountDue)}</dd>
        </div>

        {upcoming.truncated && (
          <p className="m-0 text-muted-foreground">
            More lines on the invoice itself — open the billing portal to see all of them.
          </p>
        )}
      </dl>
    </div>
  )
}

function InvoiceRow({ label, amount, muted = false }: { label: string; amount: string; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4">
      <dt className={`min-w-0 ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</dt>
      <dd className="font-mono-tb m-0 text-foreground">{amount}</dd>
    </div>
  )
}

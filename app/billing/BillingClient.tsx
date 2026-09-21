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
  ArrowRight, ChevronDown, CircleAlert, CircleCheck, CreditCard, ExternalLink,
  HardDrive, Layers3, Users,
} from 'lucide'
import { AppHeader } from '@/components/design/AppShell'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbButton } from '@/components/design/TbButton'
import {
  Eyebrow, InlineNotice, StatusBadge, TONE, UsageBar, usageFraction, usageTone,
  type PlanTone,
} from '@/components/plan/ui'
import { GraceBanner } from '@/components/plan/GraceBanner'
import { FrozenBandChip } from '@/components/plan/FrozenBandBanner'
import { AddonRows } from '@/components/billing/AddonRows'
import { formatDate, type BillingView } from '@/components/billing/types'
import { usePaywall } from '@/contexts/PaywallContext'
import { apiErrorMessage } from '@/lib/planCopy'
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
  const [billing, setBilling] = useState<BillingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')
  const [usageOpen, setUsageOpen] = useState(false)
  // Set on the very first render, not from an effect: between mount and the
  // first poll the snapshot still says `free`, and a frame of the OLD plan
  // rendered as current is exactly what this item exists to remove.
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

  useEffect(() => {
    void loadBilling()
  }, [loadBilling])

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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader crumbs={<span className="text-foreground">Billing</span>} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <header className="mb-10 grid gap-5 border-b border-border pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <Eyebrow>Plan &amp; billing</Eyebrow>
            <h1 className="font-display-tb m-0 mt-4 text-5xl font-bold uppercase leading-[.88] tracking-tight sm:text-7xl">
              Your plan,
              <br />
              at a glance.
            </h1>
          </div>
          <p className="m-0 max-w-md text-sm leading-6 text-muted-foreground">
            See what you have, what you use, and what changes your monthly total. Nothing here
            deletes anything — your tracks, comments and versions stay exactly where they are, and
            no member is ever removed for you.
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
                  <h2 className="font-display-tb m-0 text-xl font-bold uppercase tracking-tight">
                    We couldn&rsquo;t take the last payment
                  </h2>
                  <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Everything keeps working while Stripe retries
                    {subscription.nextPaymentAttempt
                      ? ` — the next attempt is ${formatDate(subscription.nextPaymentAttempt)}`
                      : ''}
                    . Update the card and the retry usually clears it straight away. If the
                    retries run out, the plan ends and bands over the limit go read-only —
                    nothing is deleted even then.
                  </p>
                </div>
              </div>
              <TbButton variant="danger" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Update payment method'}
              </TbButton>
            </div>
          </section>
        )}

        <GraceBanner className="mb-8" />

        {/* ── Current plan ──────────────────────────────────────────────── */}
        <section className="grid border border-border bg-surface/40 lg:grid-cols-[1fr_auto]">
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
              <h2 className="font-display-tb m-0 text-5xl font-bold uppercase leading-none tracking-tight sm:text-6xl">
                {confirming === 'checkout'
                  ? targetPlan
                    ? PLANS[targetPlan].name
                    : 'Your new plan'
                  : def.name}
              </h2>
              {confirming !== 'checkout' && (
                <div className="pb-1">
                  <strong className="font-display-tb text-2xl font-bold tracking-tight">
                    {def.price}
                  </strong>
                  <span className="text-sm text-muted-foreground"> / month</span>
                </div>
              )}
            </div>

            <p className="m-0 mt-3 text-sm text-muted-foreground">
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
            <TbButton
              variant="primary"
              className="h-11"
              onClick={() => openPaywall('preferences')}
            >
              {plan.plan === 'free' ? 'Choose a plan' : 'Change plan'}
              <LucideIcon icon={ArrowRight} size={13} />
            </TbButton>

            {billing?.hasBillingAccount && (
              <TbButton className="h-11" onClick={openPortal} disabled={portalBusy}>
                <LucideIcon icon={CreditCard} size={12} />
                {portalBusy ? 'Opening…' : 'Manage billing'}
                <LucideIcon icon={ExternalLink} size={11} />
              </TbButton>
            )}
          </div>
        </section>

        {subscription?.cancelAtPeriodEnd && (
          <InlineNotice
            className="mt-4"
            tone="amber"
            title={`Your subscription ends ${formatDate(subscription.currentPeriodEnd)}`}
            detail="Everything works normally until then. Reactivate before that date and nothing changes at all — after it, bands over the free limit become read-only and nothing is deleted."
          />
        )}

        <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
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
              <h2 className="font-display-tb m-0 mt-2 text-3xl font-bold uppercase tracking-tight text-foreground">
                What you&rsquo;re using
              </h2>
            </div>
            <span className="font-mono-tb hidden text-[9px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
              Live allowance
            </span>
          </div>

          <div className="grid gap-px border border-border bg-border md:grid-cols-3">
            <UsageSummary
              icon={Layers3}
              label="Bands you own"
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
              label="Largest band"
              current={topMembers}
              limit={plan.limits.membersPerBand}
            />
          </div>

          {/* The override is a FLOOR, so it is only worth naming when it is the
              number actually in force — see the same rule in PlanUsage. */}
          {plan.bandsOwnedOverridden && (
            <p className="m-0 mt-3 border-l-2 border-[var(--wave-violet)] pl-3 text-xs leading-relaxed text-muted-foreground">
              Your account has a guaranteed minimum allowance of owned bands, on top of whatever
              your plan grants.
            </p>
          )}

          {bands.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setUsageOpen(v => !v)}
                aria-expanded={usageOpen}
                className="font-mono-tb mt-2 flex h-10 w-full items-center justify-between border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
              >
                {usageOpen ? 'Hide band details' : 'Show usage by band'}
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
                        <strong className="truncate text-sm font-medium text-foreground">
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
            body="New limits switch on as soon as the payment clears, and any band frozen for being over the old limit comes back immediately — nothing to restore."
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
          />
        </div>

        {/*
          The design closes on an "estimated monthly total". This does not, and
          deliberately: `lib/plans.ts` says of its price strings that nothing
          parses them, and no numeric price exists anywhere in the app —
          `lib/billing/config.ts` maps plans to Stripe Price ids and restates no
          amount, on purpose. A total computed here would be a second source of
          truth for money, and the one place it must never disagree is the
          invoice. So the footer keeps the shape and points at the authority.
        */}
        <footer className="mt-8 flex flex-col justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
          <div>
            <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Billed monthly
            </span>
            <div className="font-display-tb mt-1 text-3xl font-bold tracking-tight text-foreground">
              {def.price}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                + any add-ons
              </span>
            </div>
          </div>
          <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
            <LucideIcon icon={CircleCheck} size={14} className="text-lime" />
            Prices in USD · cancel anytime · the exact charge is on your Stripe invoice.
          </p>
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
    <div className="bg-surface/40 p-5 sm:p-6">
      <div className="flex items-center gap-2 text-lime">
        <LucideIcon icon={icon} size={14} />
        <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="font-display-tb mt-5 text-2xl font-bold uppercase tracking-tight text-foreground">
        {show(current)}
        <span className="text-muted-foreground">
          {' / '}
          {limit === null ? 'Unlimited' : show(limit)}
        </span>
      </div>
      <div className="mt-4 h-[3px] w-full bg-border">
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
    <article className="border border-border bg-surface/40 p-5">
      <h3 className="font-display-tb m-0 flex items-center gap-2 text-base font-bold uppercase tracking-tight text-foreground">
        <LucideIcon icon={ArrowRight} size={13} className="text-lime" />
        {title}
      </h3>
      <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  )
}

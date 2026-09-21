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
import { ArrowRight, CircleAlert, CircleCheck, CreditCard, ExternalLink } from 'lucide'
import { AppHeader } from '@/components/design/AppShell'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbButton } from '@/components/design/TbButton'
import { Eyebrow, InlineNotice, StatusBadge, type PlanTone } from '@/components/plan/ui'
import { GraceBanner } from '@/components/plan/GraceBanner'
import { PlanUsage } from '@/components/plan/PlanUsage'
import { AddonCards } from '@/components/billing/AddonCards'
import { formatDate, type BillingView } from '@/components/billing/types'
import { usePaywall } from '@/contexts/PaywallContext'
import { apiErrorMessage } from '@/lib/planCopy'
import { PLANS } from '@/lib/plans'

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

export function BillingClient() {
  const params = useSearchParams()
  const checkoutResult = params.get('checkout')

  const { snapshot: plan, openPaywall, refresh } = usePaywall()
  const [billing, setBilling] = useState<BillingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')

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

  // Coming back from a successful checkout, the webhook may still be in
  // flight. One refresh a moment later is the difference between landing on
  // your new plan and landing on the old one with no explanation.
  useEffect(() => {
    if (checkoutResult !== 'success') return
    const timer = setTimeout(() => {
      void refresh()
      void loadBilling()
    }, 2500)
    return () => clearTimeout(timer)
  }, [checkoutResult, refresh, loadBilling])

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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader crumbs={<span className="text-foreground">Billing</span>} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <header>
          <Eyebrow>Plan &amp; billing</Eyebrow>
          <h1 className="font-display-tb m-0 mt-3 text-3xl font-bold uppercase leading-none tracking-tight sm:text-5xl">
            What you&rsquo;re on, and what it covers
          </h1>
          <p className="m-0 mt-4 max-w-2xl font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Nothing here deletes anything. Changing or ending a plan changes what you can add next
            — your tracks, comments and versions stay exactly where they are, and no member is
            ever removed for you.
          </p>
        </header>

        {/* ── Return from checkout ──────────────────────────────────────── */}
        {checkoutResult === 'success' && (
          <div className="mt-8">
            <InlineNotice
              tone="lime"
              title="Payment received — thank you"
              detail="Your plan switches over as soon as Stripe confirms it, usually within a few seconds. This page updates itself."
            />
          </div>
        )}
        {checkoutResult === 'cancelled' && (
          <div className="mt-8">
            <InlineNotice
              tone="amber"
              title="Checkout closed"
              detail="Nothing was charged and nothing changed. You can pick a plan again whenever you like."
            />
          </div>
        )}

        {error && (
          <div className="mt-8">
            <InlineNotice title={error} />
          </div>
        )}

        {/* ── Payment recovery ──────────────────────────────────────────── */}
        {subscription?.paymentFailedAt && (
          <section className="mt-8 border border-destructive/40 bg-destructive/[0.06] px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 grow basis-72 gap-3">
                <span className="mt-0.5 shrink-0 text-destructive">
                  <LucideIcon icon={CircleAlert} size={18} />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display-tb m-0 text-[15px] font-bold uppercase tracking-tight">
                    We couldn&rsquo;t take the last payment
                  </h2>
                  <p className="m-0 mt-2 max-w-2xl font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
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
              <TbButton variant="primary" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? 'Opening…' : 'Update payment method'}
              </TbButton>
            </div>
          </section>
        )}

        {/* ── Grace / enforced ──────────────────────────────────────────── */}
        <div className="mt-8">
          <GraceBanner />
        </div>

        {/* ── Subscription ──────────────────────────────────────────────── */}
        <section className="mt-8 border border-border bg-surface/40">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-4">
            <div className="min-w-0">
              <Eyebrow>Current subscription</Eyebrow>
              <h2 className="font-display-tb m-0 mt-2 text-2xl font-bold uppercase tracking-tight">
                {def.name}
              </h2>
              <p className="m-0 mt-1.5 font-mono-tb text-[11px] text-muted-foreground">
                {def.price} / month
                {subscription?.currentPeriodEnd && (
                  <>
                    {' · '}
                    {subscription.cancelAtPeriodEnd ? 'ends' : 'renews'}{' '}
                    {formatDate(subscription.currentPeriodEnd)}
                  </>
                )}
              </p>
            </div>
            {status ? (
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            ) : (
              plan.plan === 'free' && <StatusBadge tone="mint">Free plan</StatusBadge>
            )}
          </div>

          <div className="px-4 py-4">
            {subscription?.cancelAtPeriodEnd && (
              <InlineNotice
                className="mb-4"
                tone="amber"
                title={`Your subscription ends ${formatDate(subscription.currentPeriodEnd)}`}
                detail="Everything works normally until then. Reactivate before that date and nothing changes at all — after it, bands over the free limit become read-only and nothing is deleted."
              />
            )}

            <div className="flex flex-wrap gap-2">
              <TbButton variant="primary" onClick={() => openPaywall('preferences')}>
                {plan.plan === 'free' ? 'Choose a plan' : 'Change plan'}
              </TbButton>

              {billing?.hasBillingAccount && (
                <TbButton onClick={openPortal} disabled={portalBusy}>
                  <LucideIcon icon={CreditCard} size={12} />
                  {portalBusy ? 'Opening…' : 'Manage payment & invoices'}
                  <LucideIcon icon={ExternalLink} size={11} />
                </TbButton>
              )}
            </div>

            <p className="m-0 mt-3 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
              {billing?.hasBillingAccount
                ? 'Your card, billing address, VAT details, invoices, cancellation and reactivation all live in the Stripe portal — the same place the receipts come from.'
                : billingLive
                  ? 'You have not paid for anything yet, so there is nothing to manage. Picking a plan sets that up.'
                  : 'Checkout is not open yet. Picking a plan puts you on the list, and we will write to you when it is.'}
            </p>
          </div>
        </section>

        {/* ── What a change does ────────────────────────────────────────── */}
        <section className="mt-4 grid gap-3 md:grid-cols-3">
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

        {/* ── Usage ─────────────────────────────────────────────────────── */}
        <section className="mt-10">
          <Eyebrow>Usage</Eyebrow>
          <p className="m-0 mb-4 mt-2 max-w-2xl font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Every ceiling you have, with what you are using against it. You should never meet one
            of these by surprise.
          </p>
          <PlanUsage />
        </section>

        {/* ── Add-ons ───────────────────────────────────────────────────── */}
        <div className="mt-10">
          <AddonCards
            canBuy={billingLive && !loading && subscription !== null && subscription.entitling}
          />
        </div>

        <p className="m-0 mt-10 flex items-center gap-2 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <LucideIcon icon={CircleCheck} size={12} className="text-lime" />
          Prices in USD · Cancel anytime · Nothing is ever deleted when a plan changes
        </p>
      </main>
    </div>
  )
}

function LifecycleNote({ title, body }: { title: string; body: string }) {
  return (
    <article className="border border-border bg-surface/40 px-4 py-4">
      <h3 className="font-display-tb m-0 flex items-center gap-2 text-[13px] font-bold uppercase tracking-tight text-foreground">
        <LucideIcon icon={ArrowRight} size={12} className="text-lime" />
        {title}
      </h3>
      <p className="m-0 mt-2 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </article>
  )
}

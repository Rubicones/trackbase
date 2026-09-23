import type { AddonType } from '@/lib/plans'

/** The shape `GET /api/me/billing` returns. Display copy only. */
export interface BillingSubscriptionView {
  status: string
  plan: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  paymentFailedAt: string | null
  nextPaymentAttempt: string | null
  /** Whether this status still grants the plan — `past_due` does. */
  entitling: boolean
}

export interface BillingView {
  billingLive: boolean
  hasBillingAccount: boolean
  subscription: BillingSubscriptionView | null
}

/** A non-recurring line on the next invoice, in Stripe's own words. */
export interface UpcomingInvoiceAdjustment {
  description: string
  /** Minor units (cents). Negative for a credit. */
  amount: number
}

/**
 * The shape `GET /api/me/billing/upcoming` returns — Stripe's own preview of
 * the next invoice, broken down by what each amount pays for. Every amount is
 * in the currency's minor unit, exactly as Stripe gives it; nothing here is
 * computed in the browser.
 */
export type UpcomingInvoiceView =
  | { available: false; reason: string }
  | {
      available: true
      currency: string
      subtotal: number
      total: number
      /** What will actually be collected, after any credit balance. */
      amountDue: number
      /** Negative when the account carries credit. */
      startingBalance: number
      dueAt: string | null
      /** The plan's recurring line. */
      plan: { description: string; amount: number } | null
      /** Add-ons that renew on this invoice. Scheduled removals are never here. */
      addons: { type: AddonType; name: string; quantity: number; amount: number }[]
      /** Anything not recurring: prorations left by older changes, one-off items. */
      adjustments: UpcomingInvoiceAdjustment[]
      tax: number
      discount: number
      truncated: boolean
    }

/** `POST /api/billing/addons/preview` — Stripe's price for the staged changes. */
export interface AddonQuoteView {
  buys: { type: AddonType; bandId: string | null; quantity: number }[]
  removals: { type: AddonType; bandId: string | null; quantity: number; endsAt: string }[]
  currency: string | null
  amountDue: number
  earlierAdjustments: number
  recurringDelta: number | null
  renewsAt: string | null
  prorationDate: number
}

/** An add-on payment in flight — `GET /api/billing/addons/orders/[id]`. */
export interface AddonOrderView {
  id: string
  status: 'processing' | 'paid' | 'requires_action' | 'applied' | 'failed' | 'canceled'
  amountDue: number | null
  currency: string | null
  failureReason: string | null
  hostedInvoiceUrl: string | null
}

/**
 * Money, from minor units, in the currency Stripe named.
 *
 * `Intl` is doing the work, so a zero-decimal currency (JPY) gets no decimals
 * and a three-decimal one gets three, without this file knowing which is
 * which. Never hand it a number this app worked out itself — the only amounts
 * that belong here came from Stripe.
 */
export function formatMoney(minorUnits: number, currency: string): string {
  const code = currency.toUpperCase()
  try {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
    const fractionDigits = format.resolvedOptions().maximumFractionDigits ?? 2
    return format.format(minorUnits / 10 ** fractionDigits)
  } catch {
    // An unknown currency code should not take the page down over a subtitle.
    return `${(minorUnits / 100).toFixed(2)} ${code}`
  }
}

/** "Oct 23" — the compact form a row label has room for. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

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

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

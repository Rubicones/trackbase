/**
 * Prices as the product displays them — the SHAPE and the formatting only.
 *
 * Isomorphic: no Stripe, no server imports. The amounts themselves come from
 * Stripe (`lib/billing/catalog.ts`, server) and reach the browser on the plan
 * snapshot (`GET /api/me/plan` → `prices`) or, on the static landing page, as
 * a prop rendered at build/revalidate time. Nothing in the codebase states a
 * price: the Stripe Price behind each `STRIPE_PRICE_*` id is the only answer.
 *
 * A missing entry means "Stripe could not be asked" (no key, an outage) and
 * every surface renders NO price rather than a remembered one — a stale price
 * on a pricing card is the drift this module exists to remove.
 */

import type { AddonType, PlanId } from '@/lib/plans'

export interface CatalogPrice {
  /** Minor units, exactly as Stripe's `unit_amount`. */
  unitAmount: number
  /** ISO code, lowercase, as Stripe gives it. */
  currency: string
  /** `month`, `year`… — null for a price that does not recur. */
  interval: string | null
  intervalCount: number
}

export interface PriceCatalog {
  plans: Partial<Record<PlanId, CatalogPrice>>
  addons: Partial<Record<AddonType, CatalogPrice>>
}

export const EMPTY_PRICE_CATALOG: PriceCatalog = { plans: {}, addons: {} }

/**
 * "$9", "$2.50", "€12" — whole amounts without decimals, which is how a price
 * card reads; `Intl` supplies the currency's own digits otherwise. Null when
 * there is no price to show.
 */
export function formatCatalogPrice(price: CatalogPrice | null | undefined): string | null {
  if (!price) return null
  const code = price.currency.toUpperCase()
  try {
    const probe = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    const digits = probe.resolvedOptions().maximumFractionDigits ?? 2
    const major = price.unitAmount / 10 ** digits
    const whole = Number.isInteger(major)
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(major)
  } catch {
    return `${(price.unitAmount / 100).toFixed(2)} ${code}`
  }
}

/** "month", "3 months", "year" — for "/ month" beside a price. */
export function formatInterval(price: CatalogPrice | null | undefined): string {
  if (!price?.interval) return 'month'
  return price.intervalCount > 1 ? `${price.intervalCount} ${price.interval}s` : price.interval
}

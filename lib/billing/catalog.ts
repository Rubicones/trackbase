/**
 * The price list, read from Stripe.
 *
 * ⚠ SERVER ONLY — it uses the secret key.
 *
 * Every plan and add-on already maps to a Stripe Price (`STRIPE_PRICE_*`,
 * `lib/billing/config.ts`). This reads those Prices and hands their
 * `unit_amount` to every surface that shows a price, so the number on a card
 * is the number the card is charged. There used to be price strings in
 * `lib/plans.ts` beside the Price ids, with nothing to catch the two drifting.
 *
 * ── Caching ─────────────────────────────────────────────────────────────────
 * Stripe Prices are immutable: a new amount is a new Price id, which is an
 * env change and a deploy. So a 10-minute in-memory cache per server instance
 * is not a staleness risk, and it keeps `GET /api/me/plan` (hit on every page)
 * off Stripe's rate limit. A failed read is remembered for a minute rather
 * than retried on every request during an outage.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 * No key, an unknown id, an outage: the entry is simply absent and surfaces
 * render no price. A plan screen must not go down over a subtitle.
 *
 * Free has no Stripe Price and costs nothing by definition; it is reported as
 * zero in the currency the paid plans use, so it formats like its neighbours.
 */

import type Stripe from 'stripe'
import { STRIPE_SECRET_KEY, addonPriceId, planPriceId } from '@/lib/billing/config'
import { stripeClient } from '@/lib/billing/stripe'
import { ADDON_ORDER, PLAN_ORDER } from '@/lib/plans'
import { EMPTY_PRICE_CATALOG, type CatalogPrice, type PriceCatalog } from '@/lib/planPrices'

const TTL_MS = 10 * 60 * 1000
const FAILURE_TTL_MS = 60 * 1000

let cached: { value: PriceCatalog; expiresAt: number } | null = null
let inflight: Promise<PriceCatalog> | null = null

function toCatalogPrice(price: Stripe.Price): CatalogPrice | null {
  if (typeof price.unit_amount !== 'number' || !price.active) return null
  return {
    unitAmount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
    intervalCount: price.recurring?.interval_count ?? 1,
  }
}

async function read(): Promise<PriceCatalog> {
  if (!STRIPE_SECRET_KEY) return EMPTY_PRICE_CATALOG
  const stripe = stripeClient()

  const fetchPrice = async (id: string | null): Promise<CatalogPrice | null> => {
    if (!id) return null
    try {
      return toCatalogPrice(await stripe.prices.retrieve(id))
    } catch (err) {
      console.warn('[billing] could not read price', id, (err as Error).message)
      return null
    }
  }

  const paidPlans = PLAN_ORDER.filter(plan => plan !== 'free')
  const [planPrices, addonPrices] = await Promise.all([
    Promise.all(paidPlans.map(plan => fetchPrice(planPriceId(plan)))),
    Promise.all(ADDON_ORDER.map(type => fetchPrice(addonPriceId(type)))),
  ])

  const catalog: PriceCatalog = { plans: {}, addons: {} }
  paidPlans.forEach((plan, i) => {
    const price = planPrices[i]
    if (price) catalog.plans[plan] = price
  })
  ADDON_ORDER.forEach((type, i) => {
    const price = addonPrices[i]
    if (price) catalog.addons[type] = price
  })

  const reference = Object.values(catalog.plans)[0]
  if (reference) {
    catalog.plans.free = {
      unitAmount: 0,
      currency: reference.currency,
      interval: reference.interval,
      intervalCount: reference.intervalCount,
    }
  }
  return catalog
}

export async function getPriceCatalog(): Promise<PriceCatalog> {
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.value
  if (inflight) return inflight

  inflight = read()
    .then(value => {
      const complete = Object.keys(value.plans).length > 0
      cached = { value, expiresAt: Date.now() + (complete ? TTL_MS : FAILURE_TTL_MS) }
      return value
    })
    .catch(err => {
      console.warn('[billing] price catalog unavailable', (err as Error).message)
      cached = { value: EMPTY_PRICE_CATALOG, expiresAt: Date.now() + FAILURE_TTL_MS }
      return EMPTY_PRICE_CATALOG
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

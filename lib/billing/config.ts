/**
 * Stripe wiring — the catalog seam, and nothing else.
 *
 * ⚠ SERVER ONLY. Every value here comes from a non-`NEXT_PUBLIC_` variable, so
 * importing this from a client component yields `undefined` and, worse, reads
 * as "billing is off" rather than failing. The browser learns whether billing
 * is live from `GET /api/me/plan` (`billingLive`), which is a server answer.
 *
 * ── What this file is for ───────────────────────────────────────────────────
 * `lib/plans.ts` owns limits, features and the price a human reads. Stripe owns
 * the price a card is charged. The two must never be the same value in two
 * places, so nothing here restates an amount: this module only maps a `PlanId`
 * or an `AddonType` to the Stripe Price that represents it, in both directions.
 * If an amount in Stripe and a string in `lib/plans.ts` disagree, the Stripe
 * dashboard is where it gets fixed — the app must not "correct" a charge.
 *
 * ── The flag ────────────────────────────────────────────────────────────────
 * `BILLING_LIVE` is false until the keys exist. While it is false the app keeps
 * the behaviour it has today: "Subscribe" records demand in
 * `subscription_intents` and shows the waitlist confirmation. Nothing about
 * entitlements changes either way — plans are resolved from the database in
 * both modes, and no checkout path can grant a plan without a webhook.
 *
 * It deliberately requires the WEBHOOK secret as well as the API key. A
 * deployment with a key but no verified webhook can take money and never learn
 * that it did, which is the one failure that costs a user something real.
 */

import { ADDONS, PLAN_ORDER, type AddonType, type PlanId } from '@/lib/plans'

/** Paid plans only — `free` has no Stripe Price and never will. */
const PAID_PLAN_PRICE_ENV: Record<Exclude<PlanId, 'free'>, string> = {
  solo: 'STRIPE_PRICE_SOLO',
  band: 'STRIPE_PRICE_BAND',
  band_plus: 'STRIPE_PRICE_BAND_PLUS',
}

const ADDON_PRICE_ENV: Record<AddonType, string> = {
  extra_band: 'STRIPE_PRICE_EXTRA_BAND',
  extra_storage: 'STRIPE_PRICE_EXTRA_STORAGE',
  extra_member: 'STRIPE_PRICE_EXTRA_MEMBER',
}

function env(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export const STRIPE_SECRET_KEY = env('STRIPE_SECRET_KEY')
export const STRIPE_WEBHOOK_SECRET = env('STRIPE_WEBHOOK_SECRET')

/**
 * True only when this deployment can both charge a card AND be told about it.
 * See the header for why the webhook secret is part of the test.
 */
export const BILLING_LIVE = STRIPE_SECRET_KEY !== null && STRIPE_WEBHOOK_SECRET !== null

/** The Stripe Price for a plan, or null when it is free or not configured. */
export function planPriceId(plan: PlanId): string | null {
  if (plan === 'free') return null
  return env(PAID_PLAN_PRICE_ENV[plan])
}

export function addonPriceId(type: AddonType): string | null {
  return env(ADDON_PRICE_ENV[type])
}

/**
 * Reverse lookup for the webhook: which plan does this Price represent?
 *
 * The webhook must never take a plan id from a subscription's metadata — that
 * is writable from the Stripe dashboard by anyone with access, and a typo there
 * would grant entitlements. The Price id is the identity of what was bought.
 */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null
  for (const plan of PLAN_ORDER) {
    if (plan === 'free') continue
    if (planPriceId(plan) === priceId) return plan
  }
  return null
}

export function addonForPriceId(priceId: string | null | undefined): AddonType | null {
  if (!priceId) return null
  for (const type of Object.keys(ADDONS) as AddonType[]) {
    if (addonPriceId(type) === priceId) return type
  }
  return null
}

/**
 * Which pieces of configuration are missing, for a startup log or a dev-only
 * diagnostic. Never returned to a browser: the names of the variables are not
 * secret, but the list is only actionable to whoever deploys.
 */
export function missingBillingConfig(): string[] {
  const missing: string[] = []
  if (!STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY')
  if (!STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET')
  for (const [plan, name] of Object.entries(PAID_PLAN_PRICE_ENV)) {
    if (!env(name)) missing.push(`${name} (${plan})`)
  }
  for (const [type, name] of Object.entries(ADDON_PRICE_ENV)) {
    if (!env(name)) missing.push(`${name} (${type})`)
  }
  return missing
}

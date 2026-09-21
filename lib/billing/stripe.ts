/**
 * The Stripe client.
 *
 * ⚠ SERVER ONLY — it holds the secret key.
 *
 * Lazily constructed and memoised, so importing this module from a route that
 * never reaches Stripe costs nothing, and so a deployment without keys fails
 * at the call site with a clear error rather than at import time with a blank
 * page.
 *
 * No `apiVersion` is pinned here: the installed SDK pins its own, and a
 * hand-written version string is a second place to update on an upgrade —
 * historically the place people forget.
 */

import Stripe from 'stripe'
import { STRIPE_SECRET_KEY, missingBillingConfig } from '@/lib/billing/config'

export class BillingNotConfiguredError extends Error {
  readonly missing: string[]

  constructor() {
    const missing = missingBillingConfig()
    super(`Billing is not configured (missing: ${missing.join(', ') || 'unknown'})`)
    this.name = 'BillingNotConfiguredError'
    this.missing = missing
  }
}

export function isBillingNotConfigured(err: unknown): err is BillingNotConfiguredError {
  return err instanceof BillingNotConfiguredError
}

let memo: Stripe | null = null

export function stripeClient(): Stripe {
  if (!STRIPE_SECRET_KEY) throw new BillingNotConfiguredError()
  if (!memo) {
    memo = new Stripe(STRIPE_SECRET_KEY, {
      appInfo: { name: 'Sonicdesk', url: 'https://sonicdesk.studio' },
    })
  }
  return memo
}

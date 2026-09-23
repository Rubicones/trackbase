#!/usr/bin/env node
/**
 * READ-ONLY: how the Customer Portal prorates plan switches.
 *
 *   node scripts/billing/portal-config.mjs                # .env.development.local (test)
 *   node scripts/billing/portal-config.mjs .env.local     # live — lists, never writes
 *
 * `POST /api/billing/portal` passes no `configuration`, so the portal uses the
 * DEFAULT configuration of whichever mode the key belongs to. If its
 * `subscription_update.proration_behavior` is `create_prorations`, an upgrade
 * is charged on the next renewal, not at the moment of upgrading — the same
 * deferred-charge hole the add-ons had. `always_invoice` charges at once.
 */
import { readFileSync, existsSync } from 'node:fs'
import Stripe from 'stripe'

const file = process.argv[2] ?? '.env.development.local'
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.*)\s*$/)
    if (m) process.env.STRIPE_SECRET_KEY = m[1].replace(/^['"]|['"]$/g, '')
  }
}
const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('No STRIPE_SECRET_KEY')
  process.exit(1)
}
const stripe = new Stripe(key)
const mode = key.startsWith('sk_live_') ? 'LIVE' : 'TEST'
const configs = await stripe.billingPortal.configurations.list({ limit: 20 })
console.log(`${mode} mode — ${configs.data.length} portal configuration(s)`)
for (const c of configs.data) {
  const u = c.features.subscription_update
  const x = c.features.subscription_cancel
  console.log(`\n${c.id}${c.is_default ? '  (DEFAULT — used by /api/billing/portal)' : ''}${c.active ? '' : '  (inactive)'}`)
  console.log(`  plan switching:        ${u.enabled ? 'enabled' : 'disabled'}`)
  console.log(`  proration_behavior:    ${u.proration_behavior}`)
  console.log(`  billing_cycle_anchor:  ${u.billing_cycle_anchor ?? 'unchanged'}`)
  console.log(`  allowed updates:       ${JSON.stringify(u.default_allowed_updates)}`)
  console.log(`  schedule_at_period_end ${JSON.stringify(u.schedule_at_period_end ?? null)}`)
  console.log(`  products:              ${JSON.stringify((u.products ?? []).map(p => p.product))}`)
  console.log(`  cancel:                ${x.enabled ? x.mode : 'disabled'} (proration ${x.proration_behavior})`)
}

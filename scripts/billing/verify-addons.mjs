#!/usr/bin/env node
/**
 * Stripe-side verification of the add-on billing flow — TEST MODE ONLY.
 *
 *   node scripts/billing/verify-addons.mjs
 *
 * Reads STRIPE_SECRET_KEY and STRIPE_PRICE_* from .env.development.local
 * (or the environment) and REFUSES to run with anything but an sk_test_ key.
 * Everything it creates hangs off one Stripe test clock, which is deleted at
 * the end (that deletes the customer and its subscription with it).
 *
 * It exercises exactly the calls lib/billing/addonOrders.ts makes, so it
 * answers the questions that could not be answered without a live Stripe:
 *
 *   V2  two rows staged together → ONE invoice, ONE charge
 *   V3  createPreview(always_invoice, proration_date=t).amount_due
 *       === the amount the pending update actually charges, to the cent
 *   V4  declined card → pending_update, items unchanged; void → nothing charged
 *   V5  3DS card, abandoned → pending_update, requires_action; void → nothing
 *   V6  remove with proration 'none' → no credit, not on the renewal invoice
 *   V7  keep (re-add with 'none') → no charge now, back on the renewal
 *   V8  add, remove, renew → paid once for the period it was held
 *   +   same price twice on one subscription is refused (why items are shared)
 *   +   the portal's proration setting for plan switches (report only)
 *
 * The UI items (V1 "+" charges nothing, V9 discard) are checked by hand.
 */

import { readFileSync, existsSync } from 'node:fs'
import Stripe from 'stripe'

// ── env ────────────────────────────────────────────────────────────────────
function loadEnv(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnv('.env.development.local')

const key = process.env.STRIPE_SECRET_KEY ?? ''
if (!key.startsWith('sk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key (sk_test_…).')
  process.exit(1)
}
const PRICE = {
  plan: process.env.STRIPE_PRICE_BAND,
  storage: process.env.STRIPE_PRICE_EXTRA_STORAGE,
  band: process.env.STRIPE_PRICE_EXTRA_BAND,
}
for (const [k, v] of Object.entries(PRICE)) {
  if (!v) {
    console.error(`Missing price for ${k}`)
    process.exit(1)
  }
}

const stripe = new Stripe(key)
let failures = 0
const ok = (label, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failures += 1
}
const money = n => (n / 100).toFixed(2)

// ── helpers ────────────────────────────────────────────────────────────────
async function advance(clock, to) {
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: to })
  for (let i = 0; i < 60; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clock.id)
    if (c.status === 'ready') return
    await new Promise(r => setTimeout(r, 2000))
  }
  throw new Error('test clock did not settle')
}

async function setCard(customer, pm) {
  const attached = await stripe.paymentMethods.attach(pm, { customer })
  await stripe.customers.update(customer, {
    invoice_settings: { default_payment_method: attached.id },
  })
  return attached.id
}

async function sub(id) {
  return stripe.subscriptions.retrieve(id)
}

function qty(s, price) {
  return s.items.data.find(i => i.price.id === price)?.quantity ?? 0
}

function itemOf(s, price) {
  return s.items.data.find(i => i.price.id === price) ?? null
}

async function invoiceCount(customer) {
  const list = await stripe.invoices.list({ customer, limit: 100 })
  return list.data.length
}

async function pendingItems(customer) {
  const list = await stripe.invoiceItems.list({ customer, pending: true, limit: 100 })
  return list.data
}

/** The same call pair lib/billing/addonOrders.ts makes. */
async function buy(s, items, prorationDate) {
  const preview = await stripe.invoices.createPreview({
    customer: s.customer,
    subscription: s.id,
    subscription_details: { items, proration_behavior: 'always_invoice', proration_date: prorationDate },
  })
  const updated = await stripe.subscriptions.update(s.id, {
    items,
    payment_behavior: 'pending_if_incomplete',
    proration_behavior: 'always_invoice',
    proration_date: prorationDate,
    expand: ['latest_invoice.payments'],
  })
  return { preview, updated, invoice: updated.latest_invoice }
}

async function intentOf(invoice) {
  const payments = invoice.payments?.data ?? (await stripe.invoicePayments.list({ invoice: invoice.id })).data
  const ref = payments.find(p => p.payment?.payment_intent)?.payment.payment_intent
  if (!ref) return null
  return typeof ref === 'string' ? stripe.paymentIntents.retrieve(ref) : ref
}

// ── run ────────────────────────────────────────────────────────────────────
const start = Math.floor(Date.now() / 1000)
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: start,
  name: 'sonicdesk add-on verification',
})
console.log(`test clock ${clock.id}`)

try {
  const customer = await stripe.customers.create({ test_clock: clock.id, email: 'addon-verify@example.com' })
  await setCard(customer.id, 'pm_card_visa')
  let s = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PRICE.plan }],
  })
  const periodEnd = s.items.data[0].current_period_end

  // Mid-period, so every proration is a real, non-trivial amount.
  await advance(clock, start + 9 * 86400)
  const t = start + 9 * 86400

  // ── V2 + V3 ─────────────────────────────────────────────────────────────
  console.log('\nV2/V3  two rows, one payment, preview === charge')
  // A leftover pending item, like the ones the old charge-at-renewal flow
  // left on real accounts. The preview lists it; the charge must not.
  const leftover = await stripe.invoiceItems.create({
    customer: customer.id,
    subscription: s.id,
    amount: 400,
    currency: s.currency,
    description: 'leftover pending proration (simulated)',
  })
  const before = await invoiceCount(customer.id)
  const r1 = await buy(s, [{ price: PRICE.storage, quantity: 1 }, { price: PRICE.band, quantity: 1 }], t)
  const after = await invoiceCount(customer.id)
  ok('exactly one new invoice', after === before + 1, `${before} → ${after}`)
  ok('invoice paid', r1.invoice.status === 'paid', r1.invoice.status)
  ok('no pending_update left', r1.updated.pending_update === null)
  // The app's rule (priceBuys): the preview's lines minus existing pending items.
  const quoted = r1.preview.lines.data
    .filter(l => (l.parent?.subscription_item_details?.invoice_item ?? l.parent?.invoice_item_details?.invoice_item) !== leftover.id)
    .reduce((sum, l) => sum + l.amount, 0)
  ok(
    'quoted amount === amount charged (to the cent)',
    quoted === r1.invoice.amount_paid,
    `quoted ${money(quoted)} vs paid ${money(r1.invoice.amount_paid)} (raw preview ${money(r1.preview.amount_due)})`,
  )
  const swept = (await stripe.invoiceItems.retrieve(leftover.id)).invoice
  ok('leftover pending item NOT charged now (stays for renewal)', !swept, swept ? `swept into ${swept}` : '')
  await stripe.invoiceItems.del(leftover.id).catch(() => {})
  s = await sub(s.id)
  ok('both items applied', qty(s, PRICE.storage) === 1 && qty(s, PRICE.band) === 1)
  ok('no pending invoice items created by the change', (await pendingItems(customer.id)).length === 0)

  // ── same price twice ────────────────────────────────────────────────────
  console.log('\n+      same price twice on one subscription')
  let refused = false
  try {
    await stripe.subscriptionItems.create({ subscription: s.id, price: PRICE.storage, quantity: 1 })
  } catch (err) {
    refused = true
    console.log(`       Stripe: ${err.message}`)
  }
  ok('Stripe refuses a second item with the same price', refused)

  // ── V4 declined ─────────────────────────────────────────────────────────
  console.log('\nV4     declined card')
  await setCard(customer.id, 'pm_card_chargeCustomerFail')
  const r4 = await buy(s, [{ id: itemOf(s, PRICE.storage).id, quantity: 2 }], t + 60)
  ok('pending_update held, change not applied', !!r4.updated.pending_update && qty(await sub(s.id), PRICE.storage) === 1)
  const pi4 = await intentOf(r4.invoice)
  ok('payment intent needs a new payment method', pi4?.status === 'requires_payment_method', pi4?.status)
  await stripe.invoices.voidInvoice(r4.invoice.id)
  s = await sub(s.id)
  ok('void discards the pending update', s.pending_update === null && qty(s, PRICE.storage) === 1)
  ok('nothing charged', (await stripe.invoices.retrieve(r4.invoice.id)).amount_paid === 0)
  await setCard(customer.id, 'pm_card_visa')

  // ── V5 3DS abandoned ────────────────────────────────────────────────────
  console.log('\nV5     3D Secure, abandoned')
  await setCard(customer.id, 'pm_card_authenticationRequired')
  const r5 = await buy(s, [{ id: itemOf(s, PRICE.storage).id, quantity: 2 }], t + 120)
  const pi5 = await intentOf(r5.invoice)
  ok('requires_action (3DS)', pi5?.status === 'requires_action', pi5?.status)
  ok('hosted invoice page available', !!r5.invoice.hosted_invoice_url)
  ok('change not applied while waiting', qty(await sub(s.id), PRICE.storage) === 1)
  await stripe.invoices.voidInvoice(r5.invoice.id) // what "Cancel payment" does
  s = await sub(s.id)
  ok('abandoned → no add-on', s.pending_update === null && qty(s, PRICE.storage) === 1)
  ok('abandoned → no charge', (await stripe.invoices.retrieve(r5.invoice.id)).amount_paid === 0)
  await setCard(customer.id, 'pm_card_visa')

  // ── V6 remove at period end ─────────────────────────────────────────────
  console.log('\nV6     remove: no credit, not on the renewal')
  const invoicesBeforeRemove = await invoiceCount(customer.id)
  await stripe.subscriptionItems.del(itemOf(s, PRICE.storage).id, { proration_behavior: 'none' })
  s = await sub(s.id)
  ok('no credit created', (await pendingItems(customer.id)).length === 0)
  ok('no invoice created', (await invoiceCount(customer.id)) === invoicesBeforeRemove)
  const next6 = await stripe.invoices.createPreview({ customer: customer.id, subscription: s.id })
  ok(
    'renewal preview does not bill it',
    !next6.lines.data.some(l => l.pricing?.price_details?.price === PRICE.storage),
  )

  // ── V7 keep it ──────────────────────────────────────────────────────────
  console.log('\nV7     keep it: free, back on the renewal')
  await stripe.subscriptionItems.create({
    subscription: s.id,
    price: PRICE.storage,
    quantity: 1,
    proration_behavior: 'none',
  })
  s = await sub(s.id)
  ok('no charge now', (await pendingItems(customer.id)).length === 0 && (await invoiceCount(customer.id)) === invoicesBeforeRemove)
  const next7 = await stripe.invoices.createPreview({ customer: customer.id, subscription: s.id })
  ok('renews with the add-on', next7.lines.data.some(l => l.pricing?.price_details?.price === PRICE.storage))

  // ── V8 add, remove, renew ───────────────────────────────────────────────
  console.log('\nV8     add → remove → renew: paid once, for the period it was held')
  await stripe.subscriptionItems.del(itemOf(s, PRICE.storage).id, { proration_behavior: 'none' })
  await advance(clock, periodEnd + 2 * 3600)
  const invoices = (await stripe.invoices.list({ customer: customer.id, limit: 100 })).data
  const renewal = invoices.find(i => i.billing_reason === 'subscription_cycle')
  ok('renewal invoice exists', !!renewal)
  if (renewal) {
    const lines = (await stripe.invoices.listLineItems(renewal.id, { limit: 100 })).data
    ok('renewal has no Extra storage line', !lines.some(l => l.pricing?.price_details?.price === PRICE.storage))
    ok('renewal has no proration lines', !lines.some(l => l.parent?.subscription_item_details?.proration))
    console.log(`       renewal total ${money(renewal.total)}: ${lines.map(l => l.description).join(' | ')}`)
  }
  const paid = invoices.filter(i => i.status === 'paid')
  console.log(
    `       paid over the test: ${paid.map(i => `${i.billing_reason} ${money(i.amount_paid)}`).join(', ')}`,
  )
  ok(
    'the only add-on charge before renewal is the V2 invoice',
    paid.filter(i => i.billing_reason === 'subscription_update').length === 1,
  )

  // ── Portal (report only) ────────────────────────────────────────────────
  console.log('\nPortal (TEST mode — live mode has its own configuration)')
  const configs = await stripe.billingPortal.configurations.list({ limit: 10 })
  for (const c of configs.data) {
    const u = c.features.subscription_update
    console.log(
      `       ${c.id}${c.is_default ? ' (default)' : ''}: plan switching ${u.enabled ? 'ON' : 'off'}, ` +
        `proration_behavior=${u.proration_behavior}, allowed=${JSON.stringify(u.default_allowed_updates)}, ` +
        `schedule_at_period_end=${JSON.stringify(u.schedule_at_period_end ?? null)}`,
    )
  }
} finally {
  await stripe.testHelpers.testClocks.del(clock.id).catch(() => {})
  console.log(`\ncleaned up test clock ${clock.id}`)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)

/**
 * Add-on changes: priced by Stripe, paid before they apply, removed at period
 * end.
 *
 * ⚠ SERVER ONLY.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 * Add-ons used to be `subscriptionItems.create/update/del` with Stripe's
 * default `create_prorations`: the capacity was granted on the click and the
 * prorated charge sat as a pending invoice item until the next renewal. A
 * subscription that was cancelled at period end — or whose renewal never got
 * paid — never produced that invoice, so the add-on had been free. Removal
 * credited the unused days, which the Refund Policy says we do not do.
 *
 * ── Adding: charge now, grant on payment ────────────────────────────────────
 * One `subscriptions.update` for everything staged, with
 *
 *   payment_behavior:   'pending_if_incomplete'
 *   proration_behavior: 'always_invoice'
 *   proration_date:     <the timestamp the quote was priced at>
 *
 * `always_invoice` creates and charges an invoice for the prorated remainder
 * of the period immediately. `pending_if_incomplete` means Stripe applies the
 * item change ONLY if that invoice is paid; a decline or an unfinished 3DS
 * leaves the subscription as it was, with the change parked in
 * `pending_update` until it is paid, voided, or expires (≤ 23 h). Pending
 * updates accept only `items[price|quantity|discounts]`, `proration_*`,
 * `payment_behavior`, `metadata`, `expand` and a few others — NOT item
 * metadata. So the band a new unit belongs to is recorded on the ORDER here
 * and written to the item afterwards, by the webhook, once the invoice is paid
 * (docs.stripe.com/billing/subscriptions/pending-updates).
 *
 * `proration_date` is what makes the amount on the button the amount charged:
 * the quote is a `createPreview` at that timestamp, and the update prorates as
 * of the same timestamp, to the second. The confirm re-prices at the same
 * timestamp and refuses if the answer moved (a credit balance changed, say).
 *
 * The grant is never made here. The route creates the order and the pending
 * update; `invoice.paid` / `customer.subscription.pending_update_applied`
 * land in the webhook, which calls `applyAddonOrder()`.
 *
 * ── Removing: effective at period end, no refund, reversible ────────────────
 * Stripe has no per-item "cancel at period end". The choice was between a
 * subscription SCHEDULE (a second phase without the item) and dropping the
 * item now with `proration_behavior: 'none'` while keeping the paid-for
 * capacity in our own table until the period ends. The schedule was rejected:
 *   · a schedule's next phase restates EVERY item — a plan switch in the
 *     Customer Portal, or an add-on bought mid-period, would be silently
 *     reverted at the phase boundary unless every writer also edits the phase;
 *   · a phase transition voids any pending update in flight;
 *   · a subscription managed by a schedule is harder to change in the portal.
 * Dropping the item with `none` makes the invariant structural: the renewal
 * invoice CANNOT bill an item that is not there, and nothing is credited. The
 * capacity lives on as an "ending grant" — a `plan_addons` row with `ends_at`
 * = the item's `current_period_end`, no Stripe item id, ignored by every limit
 * the instant it expires. "Keep it" puts the units back on the item with
 * `none` — free, because that period is already paid — and deletes the grant.
 *
 * ── One order at a time ─────────────────────────────────────────────────────
 * A partial unique index allows one `open`/`requires_action` order per user,
 * so a double click cannot become a double charge, and applying an order can
 * compute ABSOLUTE item targets from the snapshot it took (`items_before`):
 * running it twice lands in the same place.
 */

import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { BILLING_LIVE, addonForPriceId, addonPriceId } from '@/lib/billing/config'
import { stripeClient } from '@/lib/billing/stripe'
import {
  basePlanItem,
  findEntitlingSubscription,
  isStripeResourceMissing,
  readCustomerId,
  syncAddonsFromSubscription,
} from '@/lib/billing/store'
import {
  allocationMetadata,
  allocationsFromJson,
  allocationsToJson,
  readAllocations,
  type Allocations,
} from '@/lib/billing/addonItems'
import { ADDONS, addonHasEffect, isAddonType, type AddonType, type PlanId } from '@/lib/plans'
import { addonWithoutEffectCopy } from '@/lib/planCopy'
import { getEffectiveEntitlements } from '@/lib/entitlements'
import { settleAccount } from '@/lib/bandFreeze'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AddonLine {
  type: AddonType
  /** Null for account-wide add-ons (`extra_band`). */
  bandId: string | null
  quantity: number
}

export interface RemovalLine extends AddonLine {
  /** ISO — the end of the period already paid for. */
  endsAt: string
}

export interface StagedChange {
  type: AddonType
  bandId: string | null
  /** Positive to add, negative to remove. Never zero. */
  delta: number
}

export interface AddonQuote {
  buys: AddonLine[]
  removals: RemovalLine[]
  currency: string | null
  /**
   * Minor units Stripe will charge right now: this change's own proration
   * lines, as Stripe priced them. 0 when nothing is bought.
   */
  amountDue: number
  /**
   * NOT part of this payment: invoice items already pending on the account
   * (left by the old charge-at-renewal flow). The upcoming-invoice preview
   * lists them, the pending-update invoice does not charge them — they stay
   * on the next renewal invoice.
   */
  earlierAdjustments: number
  /** How much the monthly bill goes up from `renewsAt`, per Stripe's recurring estimate. Null if Stripe could not estimate it. */
  recurringDelta: number | null
  /** ISO — next renewal. */
  renewsAt: string | null
  /** Seconds — the instant the quote was prorated at. Sent back on confirm. */
  prorationDate: number
}

export type OrderStatus = 'open' | 'requires_action' | 'applied' | 'failed' | 'canceled'

interface OrderRow {
  id: string
  user_id: string
  subscription_id: string
  invoice_id: string | null
  status: OrderStatus
  buys: AddonLine[]
  removals: AddonLine[]
  items_before: Record<string, ItemSnapshot>
  amount_due: number | null
  currency: string | null
  proration_date: number | null
  failure_reason: string | null
  created_at: string
}

interface ItemSnapshot {
  type: AddonType
  itemId: string | null
  quantity: number
  allocations: Record<string, number>
}

interface EndingRow {
  id: string
  addon_type: AddonType
  band_id: string | null
  quantity: number
  ends_at: string
  ending_subscription_id: string | null
}

/** What the browser is told about an order. */
export interface OrderView {
  id: string
  /**
   * `processing`      waiting on Stripe (payment not settled yet)
   * `paid`            invoice paid, waiting for the webhook to grant it
   * `requires_action` the bank wants 3D Secure; `hostedInvoiceUrl` completes it
   */
  status: 'processing' | 'paid' | 'requires_action' | 'applied' | 'failed' | 'canceled'
  amountDue: number | null
  currency: string | null
  failureReason: string | null
  hostedInvoiceUrl: string | null
}

export class AddonFlowError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AddonFlowError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

// ── Limits on what one request may ask for ───────────────────────────────────

const MAX_CHANGES = 20
const MAX_UNITS_PER_CHANGE = 20
/** A quote older than this is re-priced rather than honoured. */
const QUOTE_TTL_SECONDS = 15 * 60
/**
 * An order older than this with its invoice still open is abandoned: its
 * invoice is voided (which discards the pending update) so it stops blocking
 * new changes. Stripe expires the pending update itself within 23 h anyway.
 */
const ABANDONED_ORDER_MS = 24 * 60 * 60 * 1000

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Validate the browser's staged changes. Merges duplicates; throws 400. */
export function parseChanges(raw: unknown): StagedChange[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AddonFlowError(400, 'invalid_changes', 'Nothing to change.')
  }
  if (raw.length > MAX_CHANGES) {
    throw new AddonFlowError(400, 'invalid_changes', 'Too many changes at once.')
  }

  const merged = new Map<string, StagedChange>()
  for (const entry of raw) {
    const e = (entry ?? {}) as { type?: unknown; bandId?: unknown; delta?: unknown }
    if (!isAddonType(e.type)) throw new AddonFlowError(400, 'invalid_changes', 'Unknown add-on.')
    const type = e.type
    const delta = typeof e.delta === 'number' ? e.delta : NaN
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_UNITS_PER_CHANGE) {
      throw new AddonFlowError(400, 'invalid_changes', 'Invalid quantity.')
    }
    let bandId: string | null = null
    if (ADDONS[type].bandScoped) {
      if (typeof e.bandId !== 'string' || !e.bandId) {
        throw new AddonFlowError(
          400,
          'invalid_changes',
          `${ADDONS[type].name} attaches to one space — pick which.`,
        )
      }
      bandId = e.bandId
    }
    const key = `${type}:${bandId ?? '*'}`
    const prev = merged.get(key)
    merged.set(key, { type, bandId, delta: (prev?.delta ?? 0) + delta })
  }

  const changes = [...merged.values()].filter(c => c.delta !== 0)
  if (!changes.length) throw new AddonFlowError(400, 'invalid_changes', 'Nothing to change.')
  return changes
}

// ── Context ──────────────────────────────────────────────────────────────────

interface Ctx {
  userId: string
  customerId: string
  sub: Stripe.Subscription
  plan: PlanId
  items: Map<AddonType, Stripe.SubscriptionItem>
  ending: EndingRow[]
  openOrder: OrderRow | null
}

async function loadContext(userId: string): Promise<Ctx> {
  if (!BILLING_LIVE) {
    throw new AddonFlowError(503, 'billing_unavailable', 'Add-ons are not on sale yet.')
  }

  // Stripe, not the mirror: a webhook that has not landed must not read as
  // "you have no subscription" to somebody holding the receipt.
  const customerId = await readCustomerId(userId)
  const sub = customerId ? await findEntitlingSubscription(customerId) : null
  if (!customerId || !sub) {
    throw new AddonFlowError(
      409,
      'no_subscription',
      'Add-ons extend a paid plan. Choose a plan first, then add capacity to it.',
    )
  }

  const items = new Map<AddonType, Stripe.SubscriptionItem>()
  for (const item of sub.items.data) {
    const type = addonForPriceId(item.price?.id)
    if (type) items.set(type, item)
  }

  const [{ plan }, ending, openOrder] = await Promise.all([
    getEffectiveEntitlements(userId),
    readEndingRows(userId),
    currentOpenOrder(userId),
  ])

  return { userId, customerId, sub, plan, items, ending, openOrder }
}

async function readEndingRows(userId: string): Promise<EndingRow[]> {
  const { data, error } = await supabase
    .from('plan_addons')
    .select('id, addon_type, band_id, quantity, ends_at, ending_subscription_id')
    .eq('user_id', userId)
    .gt('ends_at', new Date().toISOString())
  if (error) throw error
  return (data ?? []) as EndingRow[]
}

async function ownsBand(userId: string, bandId: string): Promise<boolean> {
  const { data } = await supabase
    .from('band_members')
    .select('band_id')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .eq('role', 'owner')
    .maybeSingle()
  return !!data
}

/** Units that renew next period — the ones a removal can take away. */
function renewingUnits(ctx: Ctx, type: AddonType, bandId: string | null): number {
  const item = ctx.items.get(type)
  if (!item) return 0
  if (!ADDONS[type].bandScoped) return item.quantity ?? 0
  return bandId ? (readAllocations(item).get(bandId) ?? 0) : 0
}

function endingFor(ctx: Ctx, type: AddonType, bandId: string | null): EndingRow[] {
  return ctx.ending.filter(row => row.addon_type === type && (row.band_id ?? null) === bandId)
}

/** Seconds — when the period the add-on's units are paid through ends. */
function periodEndFor(ctx: Pick<Ctx, 'sub' | 'items'>, type: AddonType): number | null {
  const item = ctx.items.get(type) ?? basePlanItem(ctx.sub) ?? ctx.sub.items.data[0] ?? null
  const end = (item as { current_period_end?: number } | null)?.current_period_end
  return typeof end === 'number' ? end : null
}

function periodStart(sub: Stripe.Subscription): number | null {
  const item = basePlanItem(sub) ?? sub.items.data[0] ?? null
  const start = (item as { current_period_start?: number } | null)?.current_period_start
  return typeof start === 'number' ? start : null
}

function iso(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString()
}

function shortDate(isoValue: string): string {
  return new Date(isoValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Validation ───────────────────────────────────────────────────────────────

async function splitChanges(
  ctx: Ctx,
  changes: StagedChange[],
): Promise<{ buys: AddonLine[]; removals: RemovalLine[] }> {
  const buys: AddonLine[] = []
  const removals: RemovalLine[] = []

  for (const change of changes) {
    const definition = ADDONS[change.type]

    // A band id in a request body is never trusted.
    if (change.bandId && !(await ownsBand(ctx.userId, change.bandId))) {
      throw new AddonFlowError(404, 'unknown_band', 'Unknown space.')
    }

    if (change.delta > 0) {
      // The plan comes from the resolver, never from the request. Same rule,
      // same function, as the disabled `+` on the billing screen.
      if (!addonHasEffect(ctx.plan, change.type)) {
        throw new AddonFlowError(409, 'addon_without_effect', addonWithoutEffectCopy(change.type), {
          addon_type: change.type,
          plan: ctx.plan,
        })
      }
      if (!addonPriceId(change.type)) {
        console.error(`[billing] no Stripe price configured for addon ${change.type}`)
        throw new AddonFlowError(503, 'billing_unavailable', 'That add-on is not on sale yet.')
      }
      // Buying again what is already paid for this period would charge twice
      // for the same days. "Keep it" is free and does the same thing.
      const ending = endingFor(ctx, change.type, change.bandId)
      if (ending.length) {
        throw new AddonFlowError(
          409,
          'keep_first',
          `${definition.name} is set to end on ${shortDate(ending[0].ends_at)} and is already paid until then — keep it instead of buying it again.`,
          { addon_type: change.type, band_id: change.bandId },
        )
      }
      buys.push({ type: change.type, bandId: change.bandId, quantity: change.delta })
    } else {
      const units = -change.delta
      if (renewingUnits(ctx, change.type, change.bandId) < units) {
        throw new AddonFlowError(
          409,
          'nothing_to_remove',
          `There is no renewing ${definition.name} there to remove.`,
          { addon_type: change.type, band_id: change.bandId },
        )
      }
      const endsAt = iso(periodEndFor(ctx, change.type))
      if (!endsAt) throw new AddonFlowError(500, 'no_period', 'Could not read your billing period.')
      removals.push({ type: change.type, bandId: change.bandId, quantity: units, endsAt })
    }
  }

  return { buys, removals }
}

function assertNoOrderInFlight(ctx: Ctx): void {
  if (ctx.openOrder) {
    throw new AddonFlowError(
      409,
      'order_in_progress',
      'A payment for add-ons is still being confirmed. Wait for it to finish, or cancel it, before changing anything else.',
      { order_id: ctx.openOrder.id },
    )
  }
  // A pending update we did not create (the dashboard, a script) — pricing on
  // top of it would describe a subscription that is about to change.
  if (ctx.sub.pending_update) {
    throw new AddonFlowError(
      409,
      'payment_in_progress',
      'A payment on your subscription is still being confirmed. Try again in a few minutes.',
    )
  }
}

// ── Pricing ──────────────────────────────────────────────────────────────────

type ItemParam = { id: string; quantity: number } | { price: string; quantity: number }

/** `items` for one subscriptions.update/createPreview covering every buy. */
function buyItemsParam(ctx: Ctx, buys: AddonLine[]): ItemParam[] {
  const totals = new Map<AddonType, number>()
  for (const line of buys) totals.set(line.type, (totals.get(line.type) ?? 0) + line.quantity)

  const params: ItemParam[] = []
  for (const [type, extra] of totals) {
    const item = ctx.items.get(type)
    if (item) {
      params.push({ id: item.id, quantity: (item.quantity ?? 0) + extra })
    } else {
      const price = addonPriceId(type)
      if (!price) throw new AddonFlowError(503, 'billing_unavailable', 'That add-on is not on sale yet.')
      params.push({ price, quantity: extra })
    }
  }
  return params
}

async function priceBuys(
  ctx: Ctx,
  buys: AddonLine[],
  prorationDate: number,
): Promise<Pick<AddonQuote, 'currency' | 'amountDue' | 'earlierAdjustments' | 'recurringDelta'>> {
  const stripe = stripeClient()
  const items = buyItemsParam(ctx, buys)

  // Stripe prices the change: the proration lines `always_invoice` will put
  // on the invoice, as of `prorationDate`.
  const [now, pending] = await Promise.all([
    stripe.invoices.createPreview({
      customer: ctx.customerId,
      subscription: ctx.sub.id,
      subscription_details: {
        items,
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
      },
    }),
    stripe.invoiceItems
      .list({ customer: ctx.customerId, pending: true, limit: 100 })
      .autoPagingToArray({ limit: 1000 }),
  ])

  // ── The preview is not the invoice ────────────────────────────────────────
  //
  // `createPreview` has upcoming-invoice semantics: it also lists every
  // invoice item already PENDING on the customer — here, prorations the old
  // charge-at-renewal flow left behind. The invoice the pending update
  // actually creates and charges does not sweep those in; they stay for the
  // renewal. Showing `now.amount_due` put them on the "Pay $X" button: one
  // $2 add-on quoted as $6, and $2 charged.
  //
  // So the charge is the preview's lines MINUS the ones that are existing
  // pending items (matched by invoice item id — nothing is inferred from
  // price or dates). Stripe's own amounts, Stripe's own line split; the only
  // step here is leaving out what Stripe itself says is already pending.
  const pendingIds = new Set(pending.map(item => item.id))
  let thisChange = 0
  let earlierAdjustments = 0
  for (const line of now.lines.data) {
    const invoiceItem =
      line.parent?.subscription_item_details?.invoice_item ??
      line.parent?.invoice_item_details?.invoice_item ??
      null
    const exclusiveTax = (line.taxes ?? [])
      .filter(tax => tax.tax_behavior === 'exclusive')
      .reduce((sum, tax) => sum + tax.amount, 0)
    if (invoiceItem && pendingIds.has(invoiceItem)) {
      earlierAdjustments += line.amount + exclusiveTax
    } else {
      thisChange += line.amount + exclusiveTax
    }
  }
  if (now.lines.has_more) {
    // Never quote a number assembled from half the lines.
    throw new AddonFlowError(
      409,
      'too_many_lines',
      'Your account has too many unbilled items to price this change here. Contact support.',
    )
  }
  // The account's credit (negative balance) is applied to the new invoice
  // exactly as it would be to any other; a debit balance is added.
  const amountDue = Math.max(0, thisChange + (now.starting_balance ?? 0))

  // The monthly difference from the next renewal: Stripe's own recurring
  // estimate with and without the change. A subscription set to cancel is
  // not estimable ("cancellations are not supported with recurring
  // estimates") — then the screen simply omits the line.
  let recurringDelta: number | null = null
  try {
    const [before, after] = await Promise.all([
      stripe.invoices.createPreview({
        customer: ctx.customerId,
        subscription: ctx.sub.id,
        preview_mode: 'recurring',
      }),
      stripe.invoices.createPreview({
        customer: ctx.customerId,
        subscription: ctx.sub.id,
        preview_mode: 'recurring',
        subscription_details: { items },
      }),
    ])
    recurringDelta = after.total - before.total
  } catch (err) {
    console.warn('[billing] recurring estimate unavailable', (err as Error).message)
  }

  return { currency: now.currency, amountDue, earlierAdjustments, recurringDelta }
}

// ── Preview ──────────────────────────────────────────────────────────────────

export async function previewAddonChanges(userId: string, rawChanges: unknown): Promise<AddonQuote> {
  const changes = parseChanges(rawChanges)
  const ctx = await loadContext(userId)
  assertNoOrderInFlight(ctx)
  const { buys, removals } = await splitChanges(ctx, changes)

  const prorationDate = Math.floor(Date.now() / 1000)
  const priced = buys.length
    ? await priceBuys(ctx, buys, prorationDate)
    : { currency: null, amountDue: 0, earlierAdjustments: 0, recurringDelta: 0 }

  return {
    buys,
    removals,
    ...priced,
    renewsAt: iso(periodEndFor(ctx, buys[0]?.type ?? removals[0]?.type ?? 'extra_band')),
    prorationDate,
  }
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export async function confirmAddonChanges(
  userId: string,
  body: {
    changes?: unknown
    prorationDate?: unknown
    expectedAmount?: unknown
    expectedCurrency?: unknown
  },
): Promise<OrderView> {
  const changes = parseChanges(body.changes)
  const ctx = await loadContext(userId)
  assertNoOrderInFlight(ctx)
  const { buys, removals } = await splitChanges(ctx, changes)

  let amountDue = 0
  let currency: string | null = null
  const prorationDate =
    typeof body.prorationDate === 'number' ? Math.floor(body.prorationDate) : NaN

  if (buys.length) {
    const nowSec = Math.floor(Date.now() / 1000)
    const start = periodStart(ctx.sub)
    if (
      !Number.isFinite(prorationDate) ||
      prorationDate > nowSec + 60 ||
      nowSec - prorationDate > QUOTE_TTL_SECONDS ||
      (start !== null && prorationDate < start)
    ) {
      throw new AddonFlowError(
        409,
        'quote_expired',
        'That price is out of date. Check the new amount and confirm again.',
      )
    }

    // Re-price at the SAME instant. If anything moved, the user confirms the
    // new number — never pays one they did not see.
    const priced = await priceBuys(ctx, buys, prorationDate)
    if (priced.amountDue !== body.expectedAmount || priced.currency !== body.expectedCurrency) {
      throw new AddonFlowError(409, 'amount_changed', 'The amount changed. Check it and confirm again.')
    }
    amountDue = priced.amountDue
    currency = priced.currency
  }

  // Snapshot every item this order touches, so applying it is absolute.
  const itemsBefore: Record<string, ItemSnapshot> = {}
  for (const line of [...buys, ...removals]) {
    const price = addonPriceId(line.type)
    if (!price || itemsBefore[price]) continue
    const item = ctx.items.get(line.type) ?? null
    itemsBefore[price] = {
      type: line.type,
      itemId: item?.id ?? null,
      quantity: item?.quantity ?? 0,
      allocations: allocationsToJson(readAllocations(item)),
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('billing_addon_orders')
    .insert({
      user_id: userId,
      subscription_id: ctx.sub.id,
      status: 'open',
      buys,
      removals: removals.map(({ type, bandId, quantity }) => ({ type, bandId, quantity })),
      items_before: itemsBefore,
      amount_due: amountDue,
      currency,
      proration_date: buys.length ? prorationDate : null,
    })
    .select('*')
    .single()

  if (insertError) {
    // 23505: the one-open-order index — another tab or a double click won.
    if ((insertError as { code?: string }).code === '23505') {
      throw new AddonFlowError(
        409,
        'order_in_progress',
        'A payment for add-ons is already being confirmed.',
      )
    }
    throw insertError
  }
  const order = inserted as OrderRow

  // ── Removals only: no money moves, apply now ─────────────────────────────
  if (!buys.length) {
    await applyAddonOrder(order.id)
    return orderView(order.id)
  }

  // ── Buys: one pending update, one invoice, one charge ────────────────────
  const stripe = stripeClient()
  let updated: Stripe.Subscription
  try {
    updated = await stripe.subscriptions.update(
      ctx.sub.id,
      {
        items: buyItemsParam(ctx, buys),
        payment_behavior: 'pending_if_incomplete',
        proration_behavior: 'always_invoice',
        proration_date: prorationDate,
        expand: ['latest_invoice.payments'],
      },
      // A retried request (network blip) must not create a second invoice.
      { idempotencyKey: `addon-order:${order.id}` },
    )
  } catch (err) {
    await markOrder(order.id, {
      status: 'failed',
      failure_reason: ((err as Error).message ?? 'stripe_error').slice(0, 500),
    })
    throw err
  }

  const invoice =
    updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? (updated.latest_invoice as Stripe.Invoice)
      : null
  // New invoice = not the one the subscription pointed at before the update.
  // (Compared by id, not by timestamp: our clock and Stripe's are not the
  // same clock.)
  const previousInvoiceId =
    typeof ctx.sub.latest_invoice === 'string' ? ctx.sub.latest_invoice : ctx.sub.latest_invoice?.id
  const invoiceIsOurs = !!invoice?.id && invoice.id !== previousInvoiceId

  if (!invoice?.id || !invoiceIsOurs) {
    // No new invoice means nothing needed paying — Stripe applied the change
    // outright. Only possible for a zero amount (a trial, a 100% coupon);
    // anything else is an invariant broken, and granting would be wrong.
    if (amountDue === 0 && !updated.pending_update) {
      await applyAddonOrder(order.id, { noInvoice: true })
      return orderView(order.id)
    }
    await markOrder(order.id, { status: 'failed', failure_reason: 'no_invoice' })
    throw new AddonFlowError(
      502,
      'no_invoice',
      'Stripe did not create an invoice for this change. Nothing was granted.',
    )
  }

  // The webhook may already have claimed the order by subscription; only
  // fill the invoice id if it is still empty.
  await supabase
    .from('billing_addon_orders')
    .update({ invoice_id: invoice.id, updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('invoice_id', null)

  // From here on the order carries the invoice's OWN amount, so "Charged $X"
  // is what Stripe billed, not what we predicted.
  await supabase
    .from('billing_addon_orders')
    .update({ amount_due: invoice.amount_due, currency: invoice.currency })
    .eq('id', order.id)

  if (invoice.amount_due !== amountDue) {
    console.error(
      '[billing] add-on invoice amount differs from the quote',
      { order: order.id, invoice: invoice.id, quoted: amountDue, invoiced: invoice.amount_due },
    )
    // Not paid yet (3DS pending, declined): do not let the user approve a
    // number they were not shown. Void it; nothing is charged or applied.
    if (invoice.status !== 'paid') {
      await markOrder(order.id, { status: 'failed', failure_reason: 'amount_mismatch' })
      await voidInvoiceQuietly(invoice.id)
      throw new AddonFlowError(
        409,
        'amount_changed',
        'Stripe priced this differently from the quote, so nothing was charged. Check the new amount and confirm again.',
      )
    }
  }

  if (!updated.pending_update && invoice.status === 'paid') {
    // Paid. The webhook grants it; the browser polls the order.
    return orderView(order.id)
  }

  const intent = await paymentIntentOf(invoice)
  if (intent && (intent.status === 'requires_action' || intent.status === 'requires_confirmation')) {
    await markOrder(order.id, { status: 'requires_action' })
    return orderView(order.id)
  }
  if (intent && intent.status === 'processing') {
    return orderView(order.id)
  }

  // Declined. Void the invoice — that discards the pending update — so a
  // retry after a card change is a clean new charge, and so Stripe's retry
  // schedule never charges this later behind the user's back.
  // Marked first, so the `invoice.voided` webhook this triggers finds the
  // order already closed and the screen reports the decline, not a cancel.
  await markOrder(order.id, {
    status: 'failed',
    failure_reason: (intent?.last_payment_error?.message ?? 'declined').slice(0, 500),
  })
  await voidInvoiceQuietly(invoice.id)
  return orderView(order.id)
}

async function paymentIntentOf(invoice: Stripe.Invoice): Promise<Stripe.PaymentIntent | null> {
  const stripe = stripeClient()
  let payments = invoice.payments?.data
  if (!payments && invoice.id) {
    try {
      payments = (await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 })).data
    } catch {
      payments = []
    }
  }
  for (const payment of payments ?? []) {
    const ref = payment.payment?.payment_intent
    if (!ref) continue
    return typeof ref === 'string' ? stripe.paymentIntents.retrieve(ref) : ref
  }
  return null
}

async function voidInvoiceQuietly(invoiceId: string): Promise<void> {
  try {
    await stripeClient().invoices.voidInvoice(invoiceId)
  } catch (err) {
    // Already void, or already paid — both are answers the status read will
    // report; neither is worth failing the request over.
    console.warn('[billing] could not void add-on invoice', invoiceId, (err as Error).message)
  }
}

async function markOrder(
  id: string,
  patch: { status?: OrderStatus; failure_reason?: string; applied_at?: string },
): Promise<void> {
  const { error } = await supabase
    .from('billing_addon_orders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Applying (webhook, and removals-only confirms) ───────────────────────────

async function readOrder(id: string): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from('billing_addon_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as OrderRow | null) ?? null
}

/**
 * Make the order true on Stripe and in `plan_addons`. Idempotent.
 *
 * Returns false when there is nothing to do YET — the invoice is not paid, or
 * the pending update has not been applied. The next event will call again.
 *
 * Every write is an absolute target computed from `items_before`, and ending
 * grants are keyed by order, so a webhook retried after a partial failure
 * lands in exactly the same state.
 *
 * Buys are only ever applied behind a PAID invoice. The two exceptions are
 * not grants of anything unpaid: a removals-only order moves no money, and
 * `noInvoice` is the zero-amount case where Stripe applied the change without
 * issuing an invoice at all.
 */
export async function applyAddonOrder(
  orderId: string,
  opts: { noInvoice?: boolean } = {},
): Promise<boolean> {
  const order = await readOrder(orderId)
  if (!order) return false
  if (order.status === 'applied') return true

  const stripe = stripeClient()

  if (order.invoice_id) {
    // A PAID invoice is the ground truth, whatever this row says. If the
    // screen reported a decline but the void failed and Stripe later
    // collected the invoice anyway, the money has moved — refusing to grant
    // what was paid for is the worse failure (same rule as the webhook's
    // `force`).
    const invoice = await stripe.invoices.retrieve(order.invoice_id)
    if (invoice.status !== 'paid') return false
  } else if (order.status === 'failed' || order.status === 'canceled') {
    return false
  } else if (order.buys.length && !opts.noInvoice) {
    // A buy with no invoice recorded yet: the route has not written it. The
    // `invoice.paid` handler claims it first; until then, nothing is granted.
    return false
  }

  const sub = await stripe.subscriptions.retrieve(order.subscription_id)
  if (sub.pending_update) return false

  const byPrice = new Map<string, Stripe.SubscriptionItem>()
  for (const item of sub.items.data) if (item.price?.id) byPrice.set(item.price.id, item)

  for (const [price, before] of Object.entries(order.items_before)) {
    const type = before.type
    const scoped = ADDONS[type].bandScoped
    const lineBuys = order.buys.filter(l => l.type === type)
    const lineRemovals = order.removals.filter(l => l.type === type)

    const target: Allocations = allocationsFromJson(before.allocations)
    let targetQty = before.quantity
    for (const l of lineBuys) {
      targetQty += l.quantity
      if (scoped && l.bandId) target.set(l.bandId, (target.get(l.bandId) ?? 0) + l.quantity)
    }
    for (const l of lineRemovals) {
      targetQty -= l.quantity
      if (scoped && l.bandId) {
        const left = (target.get(l.bandId) ?? 0) - l.quantity
        if (left > 0) target.set(l.bandId, left)
        else target.delete(l.bandId)
      }
    }

    const item = byPrice.get(price) ?? null
    const periodEnd =
      (item as { current_period_end?: number } | null)?.current_period_end ??
      periodEndFor({ sub, items: new Map() }, type)

    // 1. The capacity being removed is kept until the paid period ends —
    //    written BEFORE the item shrinks, so it never disappears early.
    for (const l of lineRemovals) {
      if (!periodEnd) throw new Error(`order ${order.id}: no period end for ${type}`)
      const { error } = await supabase.from('plan_addons').upsert(
        {
          user_id: order.user_id,
          band_id: scoped ? l.bandId : null,
          addon_type: type,
          quantity: l.quantity,
          ends_at: new Date(periodEnd * 1000).toISOString(),
          ending_subscription_id: sub.id,
          stripe_price_id: price,
          stripe_subscription_item_id: null,
          stripe_allocation_key: `ending:${order.id}:${type}:${l.bandId ?? '*'}`,
        },
        { onConflict: 'stripe_allocation_key' },
      )
      if (error) throw error
    }

    // 2. The item: absolute quantity and split, never a credit.
    if (!item) {
      if (targetQty > 0) {
        throw new Error(`order ${order.id}: paid for ${type} but the subscription has no such item`)
      }
      continue
    }
    const current = readAllocations(item)
    const splitDiffers =
      scoped &&
      (current.size !== target.size ||
        [...target].some(([band, n]) => current.get(band) !== n) ||
        !!(item.metadata && 'band_id' in item.metadata))

    try {
      if (targetQty <= 0) {
        await stripe.subscriptionItems.del(item.id, { proration_behavior: 'none' })
      } else if ((item.quantity ?? 0) !== targetQty || splitDiffers) {
        await stripe.subscriptionItems.update(item.id, {
          quantity: targetQty,
          ...(scoped ? { metadata: allocationMetadata(item.metadata, target) } : {}),
          proration_behavior: 'none',
        })
      }
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err
    }
  }

  await markOrder(order.id, { status: 'applied', applied_at: new Date().toISOString() })

  const fresh = await stripe.subscriptions.retrieve(sub.id)
  await syncAddonsFromSubscription(order.user_id, fresh)
  await settleAccount(order.user_id)
  return true
}

/**
 * The webhook's entry for `invoice.paid`: find the order this invoice pays.
 *
 * By invoice id first. If the payment settled before the route wrote the id
 * (a synchronous charge whose webhook raced the response), fall back to the
 * one open order on that subscription — unambiguous, because the database
 * allows only one per user — and claim it.
 */
export async function applyAddonOrderForInvoice(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.id) return
  let order = await orderByInvoice(invoice.id)

  if (!order && invoice.billing_reason === 'subscription_update') {
    const subscriptionId = subscriptionIdOf(invoice)
    if (subscriptionId) {
      const { data } = await supabase
        .from('billing_addon_orders')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .in('status', ['open', 'requires_action'])
        .is('invoice_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) {
        order = data as OrderRow
        await supabase
          .from('billing_addon_orders')
          .update({ invoice_id: invoice.id, updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .is('invoice_id', null)
      }
    }
  }

  if (order) await applyAddonOrder(order.id)
}

/** `pending_update_applied`: the subscription's latest invoice is the order's. */
export async function applyAddonOrderForSubscription(sub: Stripe.Subscription): Promise<void> {
  const invoiceId =
    typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id
  if (!invoiceId) return
  const order = await orderByInvoice(invoiceId)
  if (order) await applyAddonOrder(order.id)
}

/** `invoice.voided`: the charge will never happen. */
export async function closeAddonOrderForInvoice(invoiceId: string | null | undefined): Promise<void> {
  if (!invoiceId) return
  await supabase
    .from('billing_addon_orders')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('invoice_id', invoiceId)
    .in('status', ['open', 'requires_action'])
}

/** `pending_update_expired`: close whatever order on this subscription Stripe voided. */
export async function closeAddonOrdersForSubscription(subscriptionId: string): Promise<void> {
  const { data } = await supabase
    .from('billing_addon_orders')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .in('status', ['open', 'requires_action'])
  for (const row of (data ?? []) as OrderRow[]) await refreshOrder(row)
}

/** True when an invoice belongs to an add-on order — its failure is not dunning. */
export async function isAddonOrderInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  if (!invoice.id) return false
  if (await orderByInvoice(invoice.id)) return true
  if (invoice.billing_reason !== 'subscription_update') return false
  const subscriptionId = subscriptionIdOf(invoice)
  if (!subscriptionId) return false
  const { data } = await supabase
    .from('billing_addon_orders')
    .select('id')
    .eq('subscription_id', subscriptionId)
    .in('status', ['open', 'requires_action'])
    .limit(1)
    .maybeSingle()
  return !!data
}

async function orderByInvoice(invoiceId: string): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from('billing_addon_orders')
    .select('*')
    .eq('invoice_id', invoiceId)
    .maybeSingle()
  // The table ships with a manual migration. Absent means no orders exist.
  if (error) return null
  return (data as OrderRow | null) ?? null
}

function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const shape = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } }
    subscription?: unknown
  }
  const ref = shape.parent?.subscription_details?.subscription ?? shape.subscription
  if (typeof ref === 'string') return ref
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') {
    return (ref as { id: string }).id
  }
  return null
}

// ── Orders for the browser ───────────────────────────────────────────────────

/**
 * The user's order in flight, refreshed from Stripe first. An order whose
 * invoice was voided (declined, expired, cancelled) is closed on the way, so a
 * missed webhook cannot block the billing screen forever.
 */
async function currentOpenOrder(userId: string): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from('billing_addon_orders')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['open', 'requires_action'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const fresh = await refreshOrder(data as OrderRow)
  return fresh.status === 'open' || fresh.status === 'requires_action' ? fresh : null
}

async function refreshOrder(order: OrderRow): Promise<OrderRow> {
  if (order.status !== 'open' && order.status !== 'requires_action') return order

  const age = Date.now() - new Date(order.created_at).getTime()
  if (!order.invoice_id) {
    if (!order.buys.length) {
      // A removals-only order whose apply was interrupted. Applying is
      // idempotent (absolute targets, keyed grants), so finish it — leaving
      // it half-done would show an end date for an item that still renews.
      try {
        await applyAddonOrder(order.id)
      } catch (err) {
        console.error('[billing] could not finish removal order', order.id, err)
      }
    } else if (age > 10 * 60 * 1000) {
      // A buy that never reached Stripe (the route died between the insert
      // and the update). Nothing was charged.
      await markOrder(order.id, { status: 'failed', failure_reason: 'abandoned' })
    }
    return (await readOrder(order.id)) ?? order
  }

  const invoice = await stripeClient().invoices.retrieve(order.invoice_id)
  if (invoice.status === 'void' || invoice.status === 'uncollectible') {
    await markOrder(order.id, {
      status: order.status === 'requires_action' ? 'canceled' : 'failed',
    })
  } else if (invoice.status === 'open' && age > ABANDONED_ORDER_MS) {
    await voidInvoiceQuietly(order.invoice_id)
    await markOrder(order.id, { status: 'canceled' })
  }
  return (await readOrder(order.id)) ?? order
}

export async function orderView(orderId: string, userId?: string): Promise<OrderView> {
  const order = await readOrder(orderId)
  if (!order || (userId && order.user_id !== userId)) {
    throw new AddonFlowError(404, 'unknown_order', 'Unknown order.')
  }
  const fresh = await refreshOrder(order)

  let status: OrderView['status'] = 'processing'
  let hostedInvoiceUrl: string | null = null
  if (fresh.status === 'applied' || fresh.status === 'failed' || fresh.status === 'canceled') {
    status = fresh.status
  } else if (fresh.invoice_id) {
    const invoice = await stripeClient().invoices.retrieve(fresh.invoice_id)
    if (invoice.status === 'paid') {
      status = 'paid'
    } else if (fresh.status === 'requires_action') {
      status = 'requires_action'
      hostedInvoiceUrl = invoice.hosted_invoice_url ?? null
    }
  }

  return {
    id: fresh.id,
    status,
    amountDue: fresh.amount_due,
    currency: fresh.currency,
    failureReason: fresh.failure_reason,
    hostedInvoiceUrl,
  }
}

/** The user walked away from 3D Secure: void it, so nothing is charged later. */
export async function cancelAddonOrder(userId: string, orderId: string): Promise<OrderView> {
  const order = await readOrder(orderId)
  if (!order || order.user_id !== userId) {
    throw new AddonFlowError(404, 'unknown_order', 'Unknown order.')
  }
  if (order.status !== 'open' && order.status !== 'requires_action') return orderView(orderId)

  if (order.invoice_id) {
    const invoice = await stripeClient().invoices.retrieve(order.invoice_id)
    // Too late — the bank already approved it. It is being granted.
    if (invoice.status === 'paid') return orderView(orderId)
    if (invoice.status === 'open') await voidInvoiceQuietly(order.invoice_id)
  }
  await markOrder(orderId, { status: 'canceled' })
  return orderView(orderId)
}

// ── Keep it ──────────────────────────────────────────────────────────────────

/**
 * Cancel a scheduled removal. Free and immediate: the period is already paid
 * for, so the units go back on the item with `proration_behavior: 'none'` and
 * renew as before.
 *
 * Refused when the grant belongs to a different period than the item's
 * current one — keeping it then would renew units at no charge for a period
 * nobody paid for (an interval change resets the period, for instance).
 */
export async function keepEndingAddon(
  userId: string,
  body: { type?: unknown; bandId?: unknown },
): Promise<void> {
  if (!isAddonType(body.type)) throw new AddonFlowError(400, 'invalid_changes', 'Unknown add-on.')
  const type = body.type
  const scoped = ADDONS[type].bandScoped
  const bandId = scoped && typeof body.bandId === 'string' && body.bandId ? body.bandId : null
  if (scoped && !bandId) throw new AddonFlowError(400, 'invalid_changes', 'Pick which space.')

  const ctx = await loadContext(userId)
  assertNoOrderInFlight(ctx)
  if (bandId && !(await ownsBand(userId, bandId))) {
    throw new AddonFlowError(404, 'unknown_band', 'Unknown space.')
  }

  const grants = endingFor(ctx, type, bandId).filter(
    row => row.ending_subscription_id === ctx.sub.id,
  )
  if (!grants.length) {
    throw new AddonFlowError(404, 'nothing_to_keep', 'That add-on is not scheduled to end.')
  }

  const periodEnd = periodEndFor(ctx, type)
  for (const grant of grants) {
    const end = Math.floor(new Date(grant.ends_at).getTime() / 1000)
    if (periodEnd === null || Math.abs(end - periodEnd) > 1) {
      throw new AddonFlowError(
        409,
        'period_changed',
        'Your billing period changed since this was removed, so it cannot be kept for free. Add it again instead.',
      )
    }
  }

  const units = grants.reduce((total, row) => total + row.quantity, 0)
  const price = addonPriceId(type)
  if (!price) throw new AddonFlowError(503, 'billing_unavailable', 'That add-on is not on sale yet.')

  const stripe = stripeClient()
  const item = ctx.items.get(type) ?? null
  const target = readAllocations(item)
  if (bandId) target.set(bandId, (target.get(bandId) ?? 0) + units)

  // Keyed on the grants being cancelled: a retry after a lost response is a
  // replay, not a second restore. (A changed state makes Stripe refuse the
  // replay outright, which is the safe failure.)
  const idempotencyKey =
    'addon-keep:' +
    createHash('sha256').update(grants.map(g => g.id).sort().join(',')).digest('hex')

  if (item) {
    await stripe.subscriptionItems.update(
      item.id,
      {
        quantity: (item.quantity ?? 0) + units,
        ...(bandId ? { metadata: allocationMetadata(item.metadata, target) } : {}),
        proration_behavior: 'none',
      },
      { idempotencyKey },
    )
  } else {
    await stripe.subscriptionItems.create(
      {
        subscription: ctx.sub.id,
        price,
        quantity: units,
        ...(bandId ? { metadata: allocationMetadata(null, target) } : {}),
        proration_behavior: 'none',
      },
      { idempotencyKey },
    )
  }

  const { error } = await supabase.from('plan_addons').delete().in('id', grants.map(g => g.id))
  if (error) throw error

  const fresh = await stripe.subscriptions.retrieve(ctx.sub.id)
  await syncAddonsFromSubscription(userId, fresh)
  await settleAccount(userId)
}

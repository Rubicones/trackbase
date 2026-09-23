'use client'

/**
 * Add-on rows — steppers STAGE, one button pays.
 *
 * From the `/subscription` route of the design kit (`sonicdesk_designs`): one
 * row per add-on, a stepper on the right, the scope spelled out in the line.
 *
 * ── The interaction model ───────────────────────────────────────────────────
 * `+` and `−` change nothing on the account and move no money. They stage a
 * change: the row shows the new count as PENDING (a "+1"/"−1" marker and a
 * highlighted row), and a summary bar appears under the rows. Changes on any
 * number of rows are staged together and confirmed together — one payment,
 * never one charge per click.
 *
 * The summary asks Stripe what the staged set costs
 * (`POST /api/billing/addons/preview`). Nothing about proration is computed
 * here: the number on the button is Stripe's `amount_due` for the invoice the
 * confirm will create, priced at a fixed `proration_date` that the confirm
 * sends back, so the charge matches it to the cent. While the price is being
 * fetched the confirm button stays disabled.
 *
 * Confirming (`POST /api/billing/addons/confirm`) returns an ORDER, not a
 * result. Adding is granted only when the webhook sees the invoice paid, so
 * the screen polls the order until it says `applied` — and until then never
 * shows the add-on as active. A card that needs 3D Secure gets Stripe's
 * hosted payment page in a new tab; abandoning it (or pressing Cancel) voids
 * the invoice: no charge, no add-on. A decline voids it too, keeps the staged
 * changes for a retry, and offers the portal to fix the card.
 *
 * Removing is not immediate. The add-on is already paid for this period, so it
 * stays active until the period ends ("1 ACTIVE · ENDS OCT 23"), is not billed
 * again, and is not refunded. Until then "Keep it" undoes the removal — free,
 * immediate, no payment step.
 *
 * Owned quantities come from the plan snapshot, which resolves them
 * server-side. This component never adds an add-on to a limit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import {
  actionOutlineTall,
  actionPrimaryTall,
  Eyebrow,
  InlineNotice,
  StatusBadge,
} from '@/components/plan/ui'
import { TbSelect } from '@/components/design/TbSelect'
import { usePaywall, usePlanTracking, type PlanAddon } from '@/contexts/PaywallContext'
import { ADDONS, ADDON_ORDER, addonHasEffect, type AddonType } from '@/lib/plans'
import { addonWithoutEffectCopy, apiErrorMessage } from '@/lib/planCopy'
import { formatCatalogPrice, formatInterval } from '@/lib/planPrices'
import {
  formatDate,
  formatMoney,
  formatShortDate,
  type AddonOrderView,
  type AddonQuoteView,
} from '@/components/billing/types'

// ── Staged changes ───────────────────────────────────────────────────────────

/** `${type}:${bandId | '*'}` → signed delta. Never holds a zero. */
type Staged = Record<string, number>

function stageKey(type: AddonType, bandId: string | null): string {
  return `${type}:${bandId ?? '*'}`
}

function parseKey(key: string): { type: AddonType; bandId: string | null } {
  const i = key.indexOf(':')
  const band = key.slice(i + 1)
  return { type: key.slice(0, i) as AddonType, bandId: band === '*' ? null : band }
}

function stagedList(staged: Staged) {
  return Object.entries(staged)
    .filter(([, delta]) => delta !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, delta]) => ({ ...parseKey(key), delta }))
}

/** What the snapshot says a row holds right now, split by how it behaves. */
function rowHoldings(addons: PlanAddon[], type: AddonType, bandId: string | null) {
  let renewing = 0
  let manual = 0
  let ending = 0
  let endsAt: string | null = null
  for (const a of addons) {
    if (a.type !== type || a.bandId !== bandId) continue
    if (a.source === 'ending') {
      ending += a.quantity
      if (a.endsAt && (!endsAt || a.endsAt < endsAt)) endsAt = a.endsAt
    } else if (a.source === 'manual') {
      manual += a.quantity
    } else {
      renewing += a.quantity
    }
  }
  return { renewing, manual, ending, endsAt, active: renewing + manual + ending }
}

// ── Flow ─────────────────────────────────────────────────────────────────────

type Flow =
  | { kind: 'idle' }
  | { kind: 'processing'; orderId: string | null }
  | { kind: 'auth'; order: AddonOrderView }

interface Outcome {
  tone: 'success' | 'failure' | 'info'
  title: string
  detail?: string
  /** Offer the Customer Portal to fix the card. */
  portal?: boolean
}

const PREVIEW_DEBOUNCE_MS = 350
const POLL_PROCESSING_MS = 1500
const POLL_AUTH_MS = 3000
/** After this long in `paid`, say so rather than spin. The poll continues. */
const PAID_PATIENCE_MS = 20000

export function AddonRows({
  canBuy,
  onChanged,
  onUpdatePaymentMethod,
}: {
  canBuy: boolean
  /**
   * Fired after a change landed. The plan snapshot refreshes itself, but the
   * next-invoice breakdown in the footer is Stripe's preview and is stale from
   * this moment.
   */
  onChanged?: () => void
  /** Opens the Stripe Customer Portal — offered after a declined card. */
  onUpdatePaymentMethod?: () => void
}) {
  const { snapshot: plan, refresh } = usePaywall()
  const track = usePlanTracking()
  const bands = plan.usage.bands
  const [bandId, setBandId] = useState<string>(() => bands[0]?.id ?? '')
  const selectedBand = useMemo(
    () => bands.find(b => b.id === bandId) ?? bands[0] ?? null,
    [bands, bandId],
  )
  const bandName = useCallback(
    (id: string | null) => (id ? (bands.find(b => b.id === id)?.name ?? 'A space') : null),
    [bands],
  )

  const [staged, setStaged] = useState<Staged>({})
  const changes = useMemo(() => stagedList(staged), [staged])
  const changesKey = useMemo(() => JSON.stringify(changes), [changes])

  const [quote, setQuote] = useState<{ key: string; value: AddonQuoteView } | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  /** Bumped to force a fresh price for the same staged set. */
  const [quoteNonce, setQuoteNonce] = useState(0)

  const [flow, setFlow] = useState<Flow>({ kind: 'idle' })
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [keepBusy, setKeepBusy] = useState<string | null>(null)

  const locked = flow.kind !== 'idle' || keepBusy !== null
  const hasBuys = changes.some(c => c.delta > 0)
  const readyQuote = quote && quote.key === changesKey && !quoteLoading ? quote.value : null

  // ── Staging ────────────────────────────────────────────────────────────────

  const stage = useCallback(
    (type: AddonType, scopeId: string | null, step: 1 | -1) => {
      setOutcome(null)
      setQuoteLoading(true)
      setQuoteError('')
      setStaged(prev => {
        const key = stageKey(type, scopeId)
        const next = { ...prev, [key]: (prev[key] ?? 0) + step }
        if (next[key] === 0) delete next[key]
        return next
      })
    },
    [],
  )

  const discard = useCallback(() => {
    setStaged({})
    setQuote(null)
    setQuoteError('')
    setOutcome(null)
  }, [])

  // ── Previewing ─────────────────────────────────────────────────────────────
  //
  // Debounced, and every response is checked against the staged set it was
  // asked about — a slow answer for "+1" must never be shown under "+2".
  //
  // The loading flag is raised by whatever changed the staged set (a stepper,
  // a "keep it", a stale quote) — in the event, not here — so this effect only
  // talks to the server.
  useEffect(() => {
    if (!changes.length) return
    const key = changesKey
    const controller = new AbortController()

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/billing/addons/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changes }),
          signal: controller.signal,
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (controller.signal.aborted) return
        if (!res.ok) {
          setQuote(null)
          setQuoteError(apiErrorMessage(data, 'Could not price these changes.'))
        } else {
          setQuote({ key, value: data as unknown as AddonQuoteView })
        }
      } catch {
        if (controller.signal.aborted) return
        setQuote(null)
        setQuoteError('Could not reach billing to price these changes.')
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // `changes` is represented by `changesKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesKey, quoteNonce])

  // ── Order outcomes ─────────────────────────────────────────────────────────

  const succeeded = useCallback(
    async (order: AddonOrderView) => {
      const charged = order.amountDue && order.currency ? order.amountDue : 0
      for (const c of changes) {
        track('addon_changed', {
          addon: c.type,
          action: c.delta > 0 ? 'add' : 'remove',
          units: Math.abs(c.delta),
          scope: ADDONS[c.type].bandScoped ? 'space' : 'account',
        })
      }
      // The snapshot first: the rows must show the new confirmed counts before
      // the pending markers disappear, never the old ones in between.
      await refresh()
      onChanged?.()
      setStaged({})
      setQuote(null)
      setFlow({ kind: 'idle' })
      setOutcome({
        tone: 'success',
        title:
          charged > 0
            ? `Added. Charged ${formatMoney(charged, order.currency as string)}.`
            : 'Changes applied.',
        detail: changes.some(c => c.delta < 0)
          ? 'Removed add-ons stay active until the end of the period you paid for.'
          : undefined,
      })
    },
    [changes, onChanged, refresh, track],
  )

  const failed = useCallback(
    (order: AddonOrderView | null, fallback?: string) => {
      track('addon_change_failed', { reason: order?.status ?? 'error' })
      setFlow({ kind: 'idle' })
      setOutcome({
        tone: 'failure',
        title: "Payment didn't go through. Nothing was changed.",
        detail:
          (order?.failureReason && order.failureReason !== 'declined'
            ? order.failureReason
            : fallback) ?? 'Your card was not charged. Your changes are still staged — try again, or update your card first.',
        portal: true,
      })
    },
    [track],
  )

  const canceled = useCallback(() => {
    track('addon_change_failed', { reason: 'canceled' })
    setFlow({ kind: 'idle' })
    setOutcome({
      tone: 'info',
      title: 'Payment cancelled. Nothing was changed.',
      detail: 'No charge was made and no add-on was added. Your changes are still staged.',
    })
  }, [track])

  /** One place that decides what an order's status means for the screen. */
  const settle = useCallback(
    async (order: AddonOrderView) => {
      switch (order.status) {
        case 'applied':
          await succeeded(order)
          return
        case 'failed':
          failed(order)
          return
        case 'canceled':
          canceled()
          return
        case 'requires_action':
          setFlow({ kind: 'auth', order })
          return
        case 'processing':
        case 'paid':
          setFlow({ kind: 'processing', orderId: order.id })
          return
      }
    },
    [canceled, failed, succeeded],
  )

  // ── Polling an order in flight ─────────────────────────────────────────────
  //
  // Until the webhook says `applied`, the add-on is not shown as granted —
  // whatever the payment did. In the 3D Secure state the poll is slower and
  // also fires when the tab regains focus, which is the moment the user comes
  // back from the bank's page.
  const orderId = flow.kind === 'processing' ? flow.orderId : flow.kind === 'auth' ? flow.order.id : null
  const [paidWaiting, setPaidWaiting] = useState(false)
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  }, [settle])

  useEffect(() => {
    if (!orderId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()
    const interval = flow.kind === 'auth' ? POLL_AUTH_MS : POLL_PROCESSING_MS

    const poll = async () => {
      if (stopped) return
      try {
        const res = await fetch(`/api/billing/addons/orders/${orderId}`)
        const data = (await res.json().catch(() => ({}))) as { order?: AddonOrderView }
        if (stopped) return
        if (res.ok && data.order) {
          if (data.order.status === 'paid' && Date.now() - startedAt > PAID_PATIENCE_MS) {
            setPaidWaiting(true)
          }
          const s = data.order.status
          const unchanged =
            (flow.kind === 'auth' && s === 'requires_action') ||
            (flow.kind === 'processing' && (s === 'processing' || s === 'paid'))
          if (!unchanged) {
            await settleRef.current(data.order)
            return
          }
        }
      } catch {
        // A dropped poll is not a failed payment. Ask again.
      }
      if (!stopped) timer = setTimeout(poll, interval)
    }

    timer = setTimeout(poll, flow.kind === 'auth' ? POLL_AUTH_MS : 600)
    const onFocus = () => {
      if (timer) clearTimeout(timer)
      void poll()
    }
    if (flow.kind === 'auth') window.addEventListener('focus', onFocus)

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      setPaidWaiting(false)
    }
  }, [orderId, flow.kind])

  // ── Confirm ────────────────────────────────────────────────────────────────

  const confirm = useCallback(async () => {
    if (!readyQuote || !changes.length) return
    setOutcome(null)
    setFlow({ kind: 'processing', orderId: null })
    try {
      const res = await fetch('/api/billing/addons/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes,
          prorationDate: readyQuote.prorationDate,
          expectedAmount: readyQuote.amountDue,
          expectedCurrency: readyQuote.currency,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setFlow({ kind: 'idle' })
        if (data.error === 'amount_changed' || data.error === 'quote_expired') {
          // Nothing was charged. Re-price and let them look again.
          setOutcome({ tone: 'info', title: apiErrorMessage(data, 'The amount changed.') })
          setQuoteLoading(true)
          setQuoteNonce(n => n + 1)
          return
        }
        setOutcome({
          tone: 'failure',
          title: 'Nothing was changed.',
          detail: apiErrorMessage(data, 'Could not change your add-ons.'),
        })
        track('addon_change_failed', { reason: String(data.error ?? res.status) })
        return
      }
      await settle(data.order as AddonOrderView)
    } catch {
      // The request may or may not have reached Stripe. Say only what is
      // certain, and do not offer a second confirm that could charge twice —
      // the server refuses one while an order is open anyway.
      setFlow({ kind: 'idle' })
      setOutcome({
        tone: 'failure',
        title: 'Could not reach billing.',
        detail: 'If a payment went through, your add-ons appear here within a minute. Reload the page before trying again.',
      })
    }
  }, [changes, readyQuote, settle, track])

  const cancelAuth = useCallback(async () => {
    if (flow.kind !== 'auth') return
    const id = flow.order.id
    setFlow({ kind: 'processing', orderId: null })
    try {
      const res = await fetch(`/api/billing/addons/orders/${id}/cancel`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { order?: AddonOrderView }
      if (res.ok && data.order) {
        await settle(data.order)
        return
      }
    } catch {
      // fall through
    }
    // Could not cancel: go back to waiting rather than pretend it stopped.
    setFlow({ kind: 'processing', orderId: id })
  }, [flow, settle])

  // ── Keep it ────────────────────────────────────────────────────────────────

  const keep = useCallback(
    async (type: AddonType, scopeId: string | null) => {
      const key = stageKey(type, scopeId)
      setKeepBusy(key)
      setOutcome(null)
      try {
        const res = await fetch('/api/billing/addons/keep', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, bandId: scopeId }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          setOutcome({
            tone: 'failure',
            title: 'Nothing was changed.',
            detail: apiErrorMessage(data, 'Could not keep this add-on.'),
          })
          return
        }
        track('addon_kept', { addon: type })
        await refresh()
        onChanged?.()
        setOutcome({
          tone: 'success',
          title: `Kept. ${ADDONS[type].name} renews as before — no charge.`,
        })
        // The staged set may have been priced against the old counts.
        if (Object.keys(staged).length) {
          setQuoteLoading(true)
          setQuoteNonce(n => n + 1)
        }
      } catch {
        setOutcome({ tone: 'failure', title: 'Could not reach billing. Nothing was changed.' })
      } finally {
        setKeepBusy(null)
      }
    },
    [onChanged, refresh, staged, track],
  )

  // A success note is a confirmation, not a fixture.
  useEffect(() => {
    if (outcome?.tone !== 'success') return
    const t = setTimeout(() => setOutcome(o => (o === outcome ? null : o)), 6000)
    return () => clearTimeout(t)
  }, [outcome])

  // ── Derived copy ───────────────────────────────────────────────────────────

  const removalEnd = (type: AddonType, scopeId: string | null): string | null =>
    readyQuote?.removals.find(r => r.type === type && r.bandId === scopeId)?.endsAt ??
    readyQuote?.renewsAt ??
    null

  // Dropping `extra_band` can put the account over its own limit once the
  // period ends. Account-wide, so both numbers are in the snapshot; storage and
  // seats are per-space and get the general sentence instead.
  const spacesRemoved = changes
    .filter(c => c.type === 'extra_band' && c.delta < 0)
    .reduce((n, c) => n - c.delta, 0)
  const spacesAfter =
    plan.limits.bandsOwned === null ? null : plan.limits.bandsOwned - spacesRemoved
  const wouldExceed =
    spacesRemoved > 0 && spacesAfter !== null && plan.usage.bandsOwned > spacesAfter

  const primaryLabel = (() => {
    if (flow.kind === 'processing') return paidWaiting ? 'Adding…' : 'Processing…'
    if (!hasBuys) return 'Apply changes'
    if (!readyQuote || !readyQuote.currency) return 'Pay and add'
    if (readyQuote.amountDue === 0) return 'Add — nothing to pay today'
    return `Pay ${formatMoney(readyQuote.amountDue, readyQuote.currency)} and add`
  })()

  const showSummary = changes.length > 0 || flow.kind !== 'idle' || outcome !== null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section>
      <div className="mb-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Eyebrow>Add-ons</Eyebrow>
          <h2 className="font-display-tb m-0 mt-2 text-3xl uppercase tracking-normal! text-foreground">
            Add only what you need
          </h2>
          <p className="font-body-tb m-0 mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Space capacity is account-wide. Storage and member seats go to one selected space.
            Nothing changes until you confirm below.
          </p>
        </div>

        {bands.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              For space
            </span>
            <TbSelect
              ariaLabel="Space these add-ons attach to"
              value={selectedBand?.id ?? ''}
              onChange={setBandId}
              options={bands.map(band => ({ value: band.id, label: band.name }))}
              className="h-10 max-w-52"
            />
          </div>
        )}
      </div>

      <div className="divide-y divide-border border border-border bg-surface">
        {ADDON_ORDER.map(type => {
          const definition = ADDONS[type]
          const scopeId = definition.bandScoped ? (selectedBand?.id ?? null) : null
          const blocked = definition.bandScoped && !selectedBand
          const scope = definition.bandScoped
            ? (selectedBand?.name ?? 'No space yet')
            : 'Account-wide'
          const held = rowHoldings(plan.addons, type, scopeId)
          const delta = staged[stageKey(type, scopeId)] ?? 0
          const hasEffect = addonHasEffect(plan.plan, type)
          const canAdd = canBuy && !blocked && hasEffect && held.ending === 0
          const plusEnabled = !locked && (delta < 0 || (canAdd && delta < 20))
          const minusEnabled = !locked && canBuy && (delta > 0 || held.renewing + delta > 0)
          const shown = held.active + delta
          const keyForRow = stageKey(type, scopeId)

          const note = !hasEffect
            ? addonWithoutEffectCopy(type)
            : held.ending > 0 && canBuy
              ? `Ending ${formatShortDate(held.endsAt)} — keep it instead of buying it again; it is already paid for.`
              : blocked
                ? 'You need a space of your own before this can attach to one.'
                : null

          const rowTone =
            delta > 0
              ? 'border-l-2 border-l-lime bg-lime/[0.05]'
              : delta < 0
                ? 'border-l-2 border-l-wave-amber bg-wave-amber/[0.05]'
                : 'border-l-2 border-l-transparent'

          return (
            <div
              key={type}
              className={`grid gap-4 p-5 transition-colors sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6 sm:p-6 ${rowTone}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display-tb m-0 mr-1 text-xl uppercase tracking-normal! text-foreground">
                    {definition.name}
                  </h3>
                  {held.active > 0 && (
                    <StatusBadge tone={held.ending > 0 ? 'amber' : 'lime'}>
                      {held.active} active
                      {held.ending > 0 &&
                        (held.ending === held.active
                          ? ` · ends ${formatShortDate(held.endsAt)}`
                          : ` · ${held.ending} ends ${formatShortDate(held.endsAt)}`)}
                    </StatusBadge>
                  )}
                  {delta !== 0 && (
                    <StatusBadge tone={delta > 0 ? 'lime' : 'amber'}>
                      {delta > 0 ? `+${delta}` : `−${-delta}`} pending
                    </StatusBadge>
                  )}
                  {held.ending > 0 && canBuy && (
                    <button
                      type="button"
                      onClick={() => void keep(type, scopeId)}
                      disabled={locked}
                      className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-lime underline underline-offset-4 transition-opacity hover:opacity-80 disabled:opacity-40"
                    >
                      {keepBusy === keyForRow ? 'Keeping…' : 'Keep it'}
                    </button>
                  )}
                </div>
                <p className="font-body-tb m-0 mt-1 text-sm leading-6 text-muted-foreground">
                  {definition.detail} <span className="text-foreground">· {scope}</span>
                </p>
                {note && (
                  <p className="font-body-tb m-0 mt-1 text-xs leading-5 text-muted-foreground">
                    {note}
                  </p>
                )}
              </div>

              {/* Stripe's price for one unit; nothing when it could not be read. */}
              <div className="font-display-tb text-2xl tracking-normal! text-foreground">
                {formatCatalogPrice(plan.prices.addons[type]) ?? (
                  <span className="text-muted-foreground">—</span>
                )}
                <span className="font-body-tb ml-1 text-xs font-normal text-muted-foreground">
                  {' '}
                  / {formatInterval(plan.prices.addons[type]) === 'month' ? 'mo' : formatInterval(plan.prices.addons[type])}
                </span>
              </div>

              <div className="flex w-fit items-center border border-border">
                <button
                  type="button"
                  aria-label={`Stage removing one ${definition.name}`}
                  disabled={!minusEnabled}
                  onClick={() => stage(type, scopeId, -1)}
                  className="grid size-9 place-items-center text-foreground transition-colors hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <LucideIcon icon={Minus} size={14} />
                </button>
                <span
                  aria-live="polite"
                  title={delta !== 0 ? `${held.active} now, ${shown} after you confirm` : undefined}
                  className={`font-mono-tb grid h-9 min-w-10 place-items-center border-x border-border text-xs ${
                    delta > 0 ? 'text-lime' : delta < 0 ? 'text-wave-amber' : 'text-foreground'
                  }`}
                >
                  {shown}
                </span>
                <button
                  type="button"
                  aria-label={`Stage adding one ${definition.name}`}
                  disabled={!plusEnabled}
                  title={!hasEffect ? addonWithoutEffectCopy(type) : undefined}
                  onClick={() => stage(type, scopeId, 1)}
                  className="grid size-9 place-items-center bg-lime text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  <LucideIcon icon={Plus} size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {!canBuy && (
        <p className="font-body-tb m-0 mt-3 text-xs leading-5 text-muted-foreground">
          Add-ons extend a paid plan — they are charged on the same subscription. Choose a plan
          first, then add capacity to it.
        </p>
      )}

      {/* ── Summary ─────────────────────────────────────────────────────────
          Flat, directly under the rows: a hairline, the staged changes as
          text, Stripe's price, and the buttons — the same footer idiom the
          page closes on. No card, no shadow. */}
      {showSummary && (
        <div role="region" aria-label="Add-on changes" className="mt-6 border-t border-border pt-6">
          {changes.length > 0 && (
            <>
              <Eyebrow tone={flow.kind === 'auth' ? 'amber' : 'lime'}>
                {flow.kind === 'auth'
                  ? 'Waiting for your bank'
                  : flow.kind === 'processing'
                    ? 'Confirming with Stripe'
                    : 'Pending — not applied yet'}
              </Eyebrow>

              <ul className="m-0 mt-4 list-none space-y-3 p-0">
                {changes.map(c => {
                  const name = ADDONS[c.type].name
                  const where = bandName(c.bandId)
                  const adding = c.delta > 0
                  return (
                    <li
                      key={stageKey(c.type, c.bandId)}
                      className="grid grid-cols-[2.5rem_1fr] items-baseline gap-3"
                    >
                      <span
                        className={`font-mono-tb text-sm ${adding ? 'text-lime' : 'text-wave-amber'}`}
                      >
                        {adding ? `+${c.delta}` : `−${-c.delta}`}
                      </span>
                      <span className="min-w-0">
                        <span className="font-display-tb text-lg uppercase tracking-normal! text-foreground">
                          {name}
                        </span>
                        {where && (
                          <span className="font-body-tb ml-2 text-sm text-muted-foreground">
                            {where}
                          </span>
                        )}
                        {!adding && (
                          <span className="font-body-tb mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {readyQuote || !quoteLoading
                              ? `Stays active until ${formatDate(removalEnd(c.type, c.bandId))}. No charge, no refund.`
                              : 'Stays active until the end of this period. No charge, no refund.'}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {/* Money: only ever Stripe's numbers. */}
              {hasBuys && (
                <div className="mt-5">
                  {quoteError ? (
                    <InlineNotice title={quoteError} />
                  ) : !readyQuote || !readyQuote.currency ? (
                    <p className="font-body-tb m-0 animate-pulse text-sm text-muted-foreground">
                      Getting the exact amount from Stripe…
                    </p>
                  ) : (
                    <dl className="font-body-tb m-0 grid gap-1 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <dt className="text-muted-foreground">Charged now:</dt>
                        <dd className="font-display-tb m-0 text-2xl tracking-normal! text-foreground">
                          {formatMoney(readyQuote.amountDue, readyQuote.currency)}
                        </dd>
                        <dd className="m-0 text-muted-foreground">— for the rest of this period</dd>
                      </div>
                      {readyQuote.recurringDelta !== null && readyQuote.recurringDelta > 0 && (
                        <div className="flex flex-wrap gap-x-2 text-muted-foreground">
                          <dt>Then</dt>
                          <dd className="m-0 text-foreground">
                            {formatMoney(readyQuote.recurringDelta, readyQuote.currency)}/month
                          </dd>
                          <dd className="m-0">from {formatDate(readyQuote.renewsAt)}</dd>
                        </div>
                      )}
                      {readyQuote.earlierAdjustments !== 0 && (
                        <p className="m-0 mt-2 text-xs leading-5 text-muted-foreground">
                          Not part of this payment:{' '}
                          <span className="font-mono-tb text-foreground">
                            {formatMoney(readyQuote.earlierAdjustments, readyQuote.currency)}
                          </span>{' '}
                          from earlier add-on changes, which stays on your next invoice.
                        </p>
                      )}
                    </dl>
                  )}
                </div>
              )}

              {!hasBuys && quoteError && <InlineNotice className="mt-4" title={quoteError} />}

              {wouldExceed && (
                <InlineNotice
                  className="mt-4"
                  tone="amber"
                  title={`You own ${plan.usage.bandsOwned} spaces and your allowance drops to ${spacesAfter} when this ends`}
                  detail="Nothing is deleted. You get 14 days, and after that the spaces over the limit go read-only until you delete one or add the capacity back."
                />
              )}
            </>
          )}

          {flow.kind === 'auth' && (
            <InlineNotice
              className="mt-4"
              tone="amber"
              title="Your bank needs to confirm this payment"
              detail="Stripe's secure payment page opens in a new tab. Approve the payment there and come back — this updates on its own. Nothing is added, and nothing is charged, until it's approved."
            />
          )}

          {flow.kind === 'processing' && paidWaiting && (
            <p className="font-body-tb m-0 mt-4 text-xs leading-5 text-muted-foreground">
              Payment received — adding it to your account. This usually takes a few seconds.
            </p>
          )}

          {outcome && (
            <InlineNotice
              className={changes.length > 0 ? 'mt-4' : ''}
              tone={outcome.tone === 'success' ? 'lime' : outcome.tone === 'info' ? 'amber' : 'destructive'}
              title={outcome.title}
              detail={outcome.detail}
              action={
                outcome.portal && onUpdatePaymentMethod ? (
                  <button
                    type="button"
                    onClick={onUpdatePaymentMethod}
                    className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-foreground underline underline-offset-4 hover:opacity-80"
                  >
                    Update payment method
                  </button>
                ) : undefined
              }
            />
          )}

          {flow.kind === 'auth' ? (
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button type="button" className={actionOutlineTall} onClick={() => void cancelAuth()}>
                Cancel payment
              </button>
              <button
                type="button"
                className={actionPrimaryTall}
                disabled={!flow.order.hostedInvoiceUrl}
                onClick={() => {
                  if (flow.order.hostedInvoiceUrl) {
                    window.open(flow.order.hostedInvoiceUrl, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                Confirm with your bank
              </button>
            </div>
          ) : (
            changes.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  className={actionOutlineTall}
                  onClick={discard}
                  disabled={locked}
                >
                  Discard changes
                </button>
                <button
                  type="button"
                  className={actionPrimaryTall}
                  onClick={() => void confirm()}
                  disabled={locked || !readyQuote || !!quoteError || !canBuy}
                >
                  {primaryLabel}
                </button>
              </div>
            )
          )}
        </div>
      )}
    </section>
  )
}

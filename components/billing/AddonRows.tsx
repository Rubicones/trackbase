'use client'

/**
 * Add-on rows.
 *
 * From the `/subscription` route of the design kit (`sonicdesk_designs`): one
 * row per add-on, a stepper on the right, and the scope spelled out in the
 * line itself. The kit's other add-on treatment — the three-card grid in
 * `/uikit/subscriptions` — is the same data in a browsing layout; this screen
 * is where the user ADJUSTS them, and a stepper says "more or fewer" in a way
 * a card with an "Add" button does not.
 *
 * Small capacity increases stay attached to the band that needs them, which is
 * the whole point of the band picker: an account-wide "more storage" would
 * have nowhere to land, because storage is never pooled across bands.
 *
 * Owned quantities are read from the plan snapshot, which resolves them
 * server-side. This component never adds an add-on to a limit — the limits it
 * displays already include every add-on by the time they arrive.
 */

import { useCallback, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import { Eyebrow, InlineNotice, StatusBadge } from '@/components/plan/ui'
import { usePaywall, type PlanAddon } from '@/contexts/PaywallContext'
import { ADDONS, ADDON_ORDER, type AddonType } from '@/lib/plans'
import { apiErrorMessage } from '@/lib/planCopy'

function quantityOf(addons: PlanAddon[], type: AddonType, bandId: string | null): number {
  return addons
    .filter(a => a.type === type && a.bandId === bandId)
    .reduce((total, a) => total + a.quantity, 0)
}

export function AddonRows({ canBuy }: { canBuy: boolean }) {
  const { snapshot: plan, refresh } = usePaywall()
  const bands = plan.usage.bands
  const [bandId, setBandId] = useState<string>(() => bands[0]?.id ?? '')
  const [busy, setBusy] = useState<AddonType | null>(null)
  const [error, setError] = useState('')

  const selectedBand = useMemo(
    () => bands.find(b => b.id === bandId) ?? bands[0] ?? null,
    [bands, bandId],
  )

  const change = useCallback(
    async (type: AddonType, action: 'add' | 'remove') => {
      setBusy(type)
      setError('')
      try {
        const res = await fetch('/api/billing/addons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            type,
            ...(ADDONS[type].bandScoped ? { bandId: selectedBand?.id } : {}),
          }),
        })
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) {
          setError(apiErrorMessage(data, 'Could not change your add-ons'))
          return
        }
        await refresh()
      } catch {
        setError('Could not reach billing. Your add-ons are unchanged.')
      } finally {
        setBusy(null)
      }
    },
    [refresh, selectedBand],
  )

  return (
    <section>
      <div className="mb-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Eyebrow>Add-ons</Eyebrow>
          <h2 className="font-display-tb m-0 mt-2 text-3xl font-bold uppercase tracking-tight text-foreground">
            Add only what you need
          </h2>
          <p className="m-0 mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Band capacity is account-wide. Storage and member seats go to one selected band, and
            everything is charged on the same subscription, prorated by Stripe against the current
            period.
          </p>
        </div>

        {bands.length > 1 && (
          <label className="font-mono-tb flex items-center gap-3 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>For band</span>
            <select
              value={selectedBand?.id ?? ''}
              onChange={e => setBandId(e.target.value)}
              className="h-10 border border-border bg-surface px-3 text-[11px] text-foreground outline-none focus:border-lime"
            >
              {bands.map(band => (
                <option key={band.id} value={band.id}>
                  {band.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <InlineNotice className="mb-4" title={error} />}

      <div className="divide-y divide-border border border-border bg-surface/40">
        {ADDON_ORDER.map(type => {
          const definition = ADDONS[type]
          const scopeId = definition.bandScoped ? (selectedBand?.id ?? null) : null
          const owned = quantityOf(plan.addons, type, scopeId)
          const blocked = definition.bandScoped && !selectedBand
          const scope = definition.bandScoped
            ? (selectedBand?.name ?? 'No band yet')
            : 'Account-wide'

          return (
            <div
              key={type}
              className="grid gap-4 p-5 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6 sm:p-6"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-display-tb m-0 text-xl font-bold uppercase tracking-tight text-foreground">
                    {definition.name}
                  </h3>
                  {owned > 0 && <StatusBadge tone="lime">{owned} active</StatusBadge>}
                </div>
                <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">
                  {definition.detail} <span className="text-foreground">· {scope}</span>
                </p>
                {blocked && (
                  <p className="m-0 mt-1 text-xs text-muted-foreground">
                    You need a band of your own before this can attach to one.
                  </p>
                )}
              </div>

              <div className="font-display-tb text-2xl font-bold tracking-tight text-foreground">
                {definition.price}
                <span className="ml-1 text-xs font-normal text-muted-foreground">/ mo</span>
              </div>

              <div className="flex w-fit items-center border border-border">
                <button
                  type="button"
                  aria-label={`Remove one ${definition.name}`}
                  disabled={!canBuy || owned === 0 || busy !== null}
                  onClick={() => change(type, 'remove')}
                  className="grid size-9 place-items-center text-foreground transition-colors hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <LucideIcon icon={Minus} size={14} />
                </button>
                <span className="font-mono-tb grid h-9 min-w-10 place-items-center border-x border-border text-xs text-foreground">
                  {busy === type ? '…' : owned}
                </span>
                <button
                  type="button"
                  aria-label={`Add ${definition.name}`}
                  disabled={!canBuy || blocked || busy !== null}
                  onClick={() => change(type, 'add')}
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
        <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
          Add-ons extend a paid plan — they are charged on the same subscription. Choose a plan
          first, then add capacity to it.
        </p>
      )}
    </section>
  )
}

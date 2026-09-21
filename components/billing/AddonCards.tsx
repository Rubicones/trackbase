'use client'

/**
 * Add-on purchase cards.
 *
 * From the design kit ("Add-ons"). Small capacity increases stay attached to
 * the band that needs them, which is the whole point of the band picker: an
 * account-wide "more storage" would have nowhere to land, because storage is
 * never pooled across bands.
 *
 * Owned quantities are read from the plan snapshot, which resolves them
 * server-side. This component never adds an addon to a limit — the limits it
 * displays already include every addon by the time they arrive.
 */

import { useCallback, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbButton } from '@/components/design/TbButton'
import { Eyebrow, InlineNotice, StatusBadge } from '@/components/plan/ui'
import { usePaywall, type PlanAddon } from '@/contexts/PaywallContext'
import { ADDONS, ADDON_ORDER, type AddonType } from '@/lib/plans'
import { apiErrorMessage } from '@/lib/planCopy'

function quantityOf(addons: PlanAddon[], type: AddonType, bandId: string | null): number {
  return addons
    .filter(a => a.type === type && a.bandId === bandId)
    .reduce((total, a) => total + a.quantity, 0)
}

export function AddonCards({ canBuy }: { canBuy: boolean }) {
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Add-ons</Eyebrow>
          <p className="m-0 mt-2 max-w-xl font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            Capacity on top of your plan, charged on the same subscription and prorated by Stripe
            against the current period. Storage and members attach to one band; an extra band is
            account-wide.
          </p>
        </div>

        {bands.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Band
            </span>
            <select
              value={selectedBand?.id ?? ''}
              onChange={e => setBandId(e.target.value)}
              className="h-8 border border-border bg-background px-2 font-mono-tb text-[11px] text-foreground outline-none focus:border-lime"
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

      {error && <InlineNotice className="mt-4" title={error} />}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ADDON_ORDER.map(type => {
          const definition = ADDONS[type]
          const scopeId = definition.bandScoped ? (selectedBand?.id ?? null) : null
          const owned = quantityOf(plan.addons, type, scopeId)
          const blocked = definition.bandScoped && !selectedBand

          return (
            <article key={type} className="flex flex-col border border-border bg-surface/40 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="grid size-8 place-items-center border border-lime text-lime">
                  <LucideIcon icon={Plus} size={14} />
                </span>
                {owned > 0 && (
                  <StatusBadge tone="lime">
                    {owned > 1 ? `${owned} owned` : 'Owned'}
                  </StatusBadge>
                )}
              </div>

              <h3 className="font-display-tb m-0 mt-4 text-[16px] font-bold uppercase tracking-tight text-foreground">
                {definition.name}
              </h3>
              <p className="m-0 mt-1.5 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
                {definition.detail}
                {definition.bandScoped && selectedBand && (
                  <>
                    {' '}
                    Applies to <span className="text-foreground">{selectedBand.name}</span>.
                  </>
                )}
              </p>

              <p className="font-display-tb m-0 my-4 text-3xl font-bold tracking-tight text-foreground">
                {definition.price}
                <span className="ml-1.5 font-mono-tb text-[10px] font-normal uppercase tracking-[0.2em] text-muted-foreground">
                  / month
                </span>
              </p>

              <div className="mt-auto flex gap-2">
                <TbButton
                  variant="primary"
                  className="flex-1"
                  disabled={!canBuy || blocked || busy !== null}
                  onClick={() => change(type, 'add')}
                >
                  {busy === type ? 'Working…' : owned > 0 ? 'Add another' : 'Add'}
                </TbButton>
                {owned > 0 && (
                  <TbButton
                    variant="menuDanger"
                    disabled={!canBuy || busy !== null}
                    onClick={() => change(type, 'remove')}
                    aria-label={`Remove one ${definition.name}`}
                  >
                    <LucideIcon icon={Trash2} size={12} />
                  </TbButton>
                )}
              </div>

              {blocked && (
                <p className="m-0 mt-2 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
                  You need a band of your own before this can attach to one.
                </p>
              )}
            </article>
          )
        })}
      </div>

      {!canBuy && (
        <p className="m-0 mt-3 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
          Add-ons extend a paid plan — they are charged on the same subscription. Choose a plan
          first, then add capacity to it.
        </p>
      )}
    </section>
  )
}

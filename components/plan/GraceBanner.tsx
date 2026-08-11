'use client'

/**
 * Grace-period banner.
 *
 * Persistent while grace is running, and deliberately not alarming. The user
 * chose to downgrade; this is information, not a punishment. It says three
 * things and nothing else: what will happen, when, and what to do about it.
 *
 * It also carries the "which bands survive" choice, because that decision is
 * only meaningful during grace and burying it in a settings page is how it
 * gets made by default instead of deliberately. If they never choose, the
 * least recently active bands are the ones that freeze —
 * `lib/freezeOrder.ts` implements that once for both the preview and the
 * enforcement.
 *
 * Nothing here is load-bearing. Freezing happens server-side whether this
 * banner rendered or not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PLANS } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import { usePaywall } from '@/contexts/PaywallContext'
import { trackGracePeriodExpired } from '@/lib/planAnalytics'
import { TbButton } from '@/components/design/TbButton'

export function GraceBanner() {
  const { snapshot: plan, refresh, openPaywall } = usePaywall()
  const [choosing, setChoosing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Derived, not synced: `draft` is null until the user touches a checkbox, so
  // the saved choice arriving from a refresh is picked up automatically without
  // an effect that would stomp on edits in progress.
  const [draft, setDraft] = useState<string[] | null>(null)
  const keep = draft ?? plan.keepBandIds
  const setKeep = (next: string[] | ((prev: string[]) => string[])) =>
    setDraft(prev => (typeof next === 'function' ? next(prev ?? plan.keepBandIds) : next))

  useEffect(() => {
    if (plan.state === 'enforced') trackGracePeriodExpired(plan.plan)
  }, [plan.state, plan.plan])

  const limit = plan.limits.bandsOwned
  const overBands = limit !== null && plan.usage.bandsOwned > limit

  /**
   * Preview of what would freeze, mirroring the server's rule: the user's
   * choice first, then the most recently active fill the remaining slots.
   */
  const wouldFreeze = useMemo(() => {
    if (!overBands || limit === null) return []
    const sorted = [...plan.usage.bands].sort(
      (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    )
    const claimed = new Set<string>()
    for (const id of keep) {
      if (claimed.size >= limit) break
      if (sorted.some(b => b.id === id)) claimed.add(id)
    }
    for (const b of sorted) {
      if (claimed.size >= limit) break
      claimed.add(b.id)
    }
    return sorted.filter(b => !claimed.has(b.id))
  }, [overBands, limit, keep, plan.usage.bands])

  const saveChoice = useCallback(async () => {
    setSaving(true)
    try {
      await fetch('/api/me/plan/keep-bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bandIds: keep }),
      })
      setDraft(null)
      await refresh()
      setChoosing(false)
    } finally {
      setSaving(false)
    }
  }, [keep, refresh])

  if (plan.state === 'active') return null

  const expired = plan.state === 'enforced'
  const deadline = plan.graceUntil ? new Date(plan.graceUntil) : null

  return (
    <div
      className={`border px-4 py-3 ${
        expired
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-[var(--wave-amber)]/40 bg-[var(--wave-amber)]/5'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[13px] uppercase tracking-tight text-foreground m-0">
            {expired
              ? 'Your plan no longer covers everything here'
              : `${plan.graceDaysLeft} ${plan.graceDaysLeft === 1 ? 'day' : 'days'} to sort this out`}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground m-0 mt-1.5 leading-relaxed">
            {expired ? (
              <>
                Bands over your {PLANS[plan.plan].name} limit are frozen — read-only, nothing
                deleted. Every file, comment and version is still there. Upgrade, or delete a band
                you no longer need, and they unfreeze straight away.
              </>
            ) : (
              <>
                You&rsquo;re on {PLANS[plan.plan].name}, which allows {limit} owned{' '}
                {limit === 1 ? 'band' : 'bands'}; you own {plan.usage.bandsOwned}. Everything keeps
                working until{' '}
                {deadline ? deadline.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : 'then'}
                . After that the extras become read-only. Nothing is ever deleted, and no member is
                ever removed.
              </>
            )}
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          {overBands && !expired && (
            <TbButton onClick={() => setChoosing(v => !v)}>
              {choosing ? 'Close' : 'Choose which to keep'}
            </TbButton>
          )}
          <TbButton variant="primary" onClick={() => openPaywall('limit')}>
            See plans
          </TbButton>
        </div>
      </div>

      {/* ── The choice ──────────────────────────────────────────────────── */}
      {choosing && limit !== null && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="font-mono text-[10px] text-muted-foreground m-0 mb-3 leading-relaxed">
            Pick the {limit} {limit === 1 ? 'band' : 'bands'} to keep active. Anything unpicked
            goes read-only when the {plan.graceDaysLeft} days are up — and comes straight back if
            you upgrade later. Leave this alone and we keep your most recently active.
          </p>

          <ul className="m-0 p-0 list-none space-y-1.5">
            {plan.usage.bands.map(band => {
              const picked = keep.includes(band.id)
              const doomed = wouldFreeze.some(b => b.id === band.id)
              return (
                <li key={band.id}>
                  <label
                    className={`flex items-center justify-between gap-3 border px-2.5 py-2 cursor-pointer ${
                      doomed ? 'border-destructive/35 bg-destructive/5' : 'border-border'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={!picked && keep.length >= limit}
                        onChange={e =>
                          setKeep(prev =>
                            e.target.checked
                              ? [...prev, band.id]
                              : prev.filter(id => id !== band.id),
                          )
                        }
                        className="size-3.5 accent-lime shrink-0"
                      />
                      <span className="font-mono text-[11px] text-foreground truncate">
                        {band.name}
                      </span>
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground shrink-0">
                      {formatStorageLimit(band.storageBytes)} ·{' '}
                      {new Date(band.lastActivityAt).toLocaleDateString()}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end gap-2 mt-3">
            <TbButton onClick={() => setDraft(null)} disabled={saving}>
              Reset
            </TbButton>
            <TbButton variant="primary" onClick={saveChoice} disabled={saving}>
              {saving ? 'Saving…' : 'Save choice'}
            </TbButton>
          </div>
        </div>
      )}
    </div>
  )
}

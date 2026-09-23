'use client'

/**
 * Grace-period banner.
 *
 * Rebuilt against the subscription design kit (`sonicdesk_designs`,
 * `/uikit/subscriptions` → "Grace & frozen states"), with the behaviour
 * intact: persistent while grace is running, and deliberately not alarming.
 * The user chose to downgrade; this is information, not a punishment. It says
 * three things and nothing else — what will happen, when, and what to do.
 *
 * It also carries the "which bands survive" choice, because that decision is
 * only meaningful during grace and burying it in a settings page is how it
 * gets made by default instead of deliberately. If they never choose, the
 * least recently active bands freeze — `lib/freezeOrder.ts` implements that
 * once, for both this preview and the enforcement.
 *
 * ── Two deliberate deviations from the kit ──────────────────────────────────
 *
 * 1. The kit stacks with `lg:flex-row`, a VIEWPORT breakpoint. This banner also
 *    renders inside the Preferences modal, which is narrow on a wide screen —
 *    so at `lg` the kit's rule would put the buttons beside the copy in a
 *    container far too narrow for it, and the sentence rendered one word per
 *    line. `flex-wrap` plus a `basis-72` on the text column decides the same
 *    thing from the space actually available. Identical at full width.
 *
 * 2. The deadline is a sentence, not a badge. The kit words it inline ("by
 *    27 Sep") and it reads better than a chip the copy then has to point at
 *    ("until the date above").
 *
 * Nothing here is load-bearing. Freezing happens server-side whether this
 * banner rendered or not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, LoaderCircle } from 'lucide'
import { PLANS } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import { usePaywall, usePlanTracking } from '@/contexts/PaywallContext'
import { trackGracePeriodExpired } from '@/lib/planAnalytics'
import { LucideIcon } from '@/components/design/LucideIcon'
import { StatusBadge, TONE } from '@/components/plan/ui'

/**
 * Kit buttons (`subscription-ui` GraceBanner). Outline inherits the banner
 * tone via `currentColor`. Solid is inverted surface (kit `--sub-fg` on
 * `--sub-bg`). Neither is `TbButton` — that component forces 10px mono caps.
 */
const outlineAction =
  'font-body-tb inline-flex h-9 items-center justify-center gap-2 rounded-none border border-current bg-transparent px-4 text-sm font-medium text-current transition-colors hover:bg-current/10 disabled:opacity-50'

const solidAction =
  'font-body-tb inline-flex h-9 items-center justify-center gap-2 rounded-none border-0 bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50'

export function GraceBanner({ className = '' }: { className?: string }) {
  const { snapshot: plan, refresh, openPaywall } = usePaywall()
  const track = usePlanTracking()
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
    track('grace_keep_saved', { kept: keep.length })
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
  }, [keep, refresh, track])

  if (plan.state === 'active') return null

  const expired = plan.state === 'enforced'
  const t = TONE[expired ? 'destructive' : 'amber']
  const deadline = plan.graceUntil
    ? new Date(plan.graceUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null

  return (
    // The tone lives on the section, so the icon, the heading and the outline
    // button all inherit it through `currentColor` — one colour decision, not
    // four that can drift apart.
    <motion.section
      layout
      className={`border p-5 ${t.text} ${t.border} ${t.wash} ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 grow basis-72 gap-3">
          <span className="mt-0.5 shrink-0">
            <LucideIcon icon={CircleAlert} size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display-tb m-0 text-xl uppercase tracking-normal!">
              {expired
                ? 'Your plan no longer covers everything here'
                : `${plan.graceDaysLeft} ${plan.graceDaysLeft === 1 ? 'day' : 'days'} to sort this out`}
            </h3>

            <p className="font-body-tb m-0 mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {expired ? (
                <>
                  Spaces over your {PLANS[plan.plan].name} limit are frozen — read-only, nothing
                  deleted. Every file, comment and version is still there. Upgrade, or delete a
                  space you no longer need, and they unfreeze straight away.
                </>
              ) : (
                <>
                  {PLANS[plan.plan].name} covers {limit} owned {limit === 1 ? 'space' : 'spaces'};
                  you currently own {plan.usage.bandsOwned}.{' '}
                  {overBands && deadline
                    ? `Choose the ${limit} to keep active by ${deadline}.`
                    : deadline
                      ? `Everything keeps working until ${deadline}; after that the extras become read-only.`
                      : 'Everything keeps working until the grace period ends.'}{' '}
                  Nothing is deleted and nobody is removed.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {overBands && !expired && (
            <button
              type="button"
              className={outlineAction}
              onClick={() => {
                track('grace_choose_toggled', { open: !choosing })
                setChoosing(v => !v)
              }}
            >
              {choosing ? 'Close' : 'Choose which to keep'}
            </button>
          )}
          <button
            type="button"
            className={solidAction}
            onClick={() => {
              track('plan_cta_clicked', { source: 'grace_banner', cta: 'see_plans' })
              openPaywall('limit')
            }}
          >
            See plans
          </button>
        </div>
      </div>

      {/* ── The choice ──────────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {choosing && limit !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-5 border-t border-current/20 pt-5">
          <p className="font-body-tb m-0 mb-4 text-xs leading-5 text-muted-foreground">
            Pick the {limit} {limit === 1 ? 'space' : 'spaces'} to keep active. Anything unpicked
            goes read-only when the {plan.graceDaysLeft} days are up — and comes straight back if
            you upgrade later. Leave this alone and we keep your most recently active.
          </p>

          <ul className="m-0 list-none space-y-2 p-0">
            {plan.usage.bands.map(band => {
              const picked = keep.includes(band.id)
              const doomed = wouldFreeze.some(b => b.id === band.id)
              return (
                <li key={band.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 border p-3 ${
                      doomed ? 'border-destructive/30 bg-destructive/5' : 'border-border'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={!picked && keep.length >= limit}
                      onChange={e =>
                        setKeep(prev =>
                          e.target.checked ? [...prev, band.id] : prev.filter(id => id !== band.id),
                        )
                      }
                      className="size-4 shrink-0 accent-lime"
                    />
                    <span className="font-body-tb min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {band.name}
                    </span>
                    <span className="font-mono-tb shrink-0 text-[9px] uppercase text-muted-foreground">
                      {formatStorageLimit(band.storageBytes)} ·{' '}
                      {new Date(band.lastActivityAt).toLocaleDateString()}
                    </span>
                    {doomed && <StatusBadge tone="destructive">Will freeze</StatusBadge>}
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="font-body-tb inline-flex h-9 items-center px-4 text-sm font-medium text-current opacity-75 transition-opacity hover:opacity-100 disabled:opacity-40"
              onClick={() => setDraft(null)}
              disabled={saving}
            >
              Reset
            </button>
            <button
              type="button"
              className={solidAction}
              onClick={saveChoice}
              disabled={saving}
            >
              {saving && (
                <span className="animate-spin">
                  <LucideIcon icon={LoaderCircle} size={14} />
                </span>
              )}
              {saving ? 'Saving…' : 'Save choice'}
            </button>
          </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

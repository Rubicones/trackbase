'use client'

/**
 * Plan display + current usage.
 *
 * Rebuilt on the subscription design kit ("Plan & usage"). The point of the
 * panel is unchanged: a user should never be surprised by a limit. Every
 * ceiling they have is listed with what they are using against it, and
 * anything within one step of full is called out before they walk into it — a
 * wall you can see coming is a different experience from a wall you hit.
 *
 * Everything rendered here is display. The numbers come from
 * `GET /api/me/plan`, which resolves them server-side; the client never
 * computes a limit and never sends one back. Addons are shown as an
 * explanation for a raised ceiling, never added to one here — the limits
 * already include them by the time they arrive.
 */

import { useMemo, type ReactNode } from 'react'
import { PLANS, formatMB, type AddonType } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import { usePaywall, usePlan, type PlanAddon } from '@/contexts/PaywallContext'
import { formatCatalogPrice, formatInterval } from '@/lib/planPrices'
import { Eyebrow, StatusBadge, UsageBar, usageTone } from '@/components/plan/ui'
import { FrozenBandChip } from '@/components/plan/FrozenBandBanner'

/** Addon units of one type attached to one band. */
function unitsFor(addons: PlanAddon[], type: AddonType, bandId: string | null): number {
  return addons
    .filter(a => a.type === type && a.bandId === bandId)
    .reduce((total, a) => total + a.quantity, 0)
}

export function PlanUsage({
  compact = false,
  footer,
}: {
  /** Drops the per-band breakdown — for the Preferences summary. */
  compact?: boolean
  footer?: ReactNode
}) {
  const plan = usePlan()
  const { loading } = usePaywall()
  const def = PLANS[plan.plan]

  const bandsTone = usageTone(plan.usage.bandsOwned, plan.limits.bandsOwned)
  const extraBands = useMemo(
    () => unitsFor(plan.addons, 'extra_band', null),
    [plan.addons],
  )

  // The override is a FLOOR (`lib/entitlements.ts`), so it is only worth
  // mentioning when it is the number actually in force. When the plan and its
  // addons already grant as much or more, it is doing nothing, and saying
  // otherwise would read as "your plan is being ignored" — which is what this
  // panel said while the override still replaced the computation.
  const planOnlyBands = def.bandsOwned === null ? null : def.bandsOwned + extraBands
  const overrideRaisesLimit =
    plan.bandsOwnedOverridden &&
    planOnlyBands !== null &&
    typeof plan.limits.bandsOwned === 'number' &&
    plan.limits.bandsOwned > planOnlyBands

  if (loading && plan.usage.bands.length === 0) return <PlanUsageSkeleton />

  return (
    // One framed panel, as in the kit: the plan header sits inside it rather
    // than in a strip of its own above loose content.
    <section className="border border-border bg-surface p-5">
      {/* ── Current plan ─────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>Plan usage</Eyebrow>
          <h3 className="font-display-tb m-0 mt-2 text-3xl uppercase leading-none tracking-normal! text-foreground">
            {def.name}
            {formatCatalogPrice(plan.prices.plans[plan.plan]) && (
              <span className="font-body-tb ml-2 text-sm font-normal normal-case text-muted-foreground">
                {formatCatalogPrice(plan.prices.plans[plan.plan])} /{' '}
                {formatInterval(plan.prices.plans[plan.plan])}
              </span>
            )}
          </h3>
        </div>
        {plan.state !== 'active' && (
          <StatusBadge tone={plan.state === 'grace' ? 'amber' : 'destructive'}>
            {plan.state === 'grace' ? `${plan.graceDaysLeft}d grace` : 'Over limit'}
          </StatusBadge>
        )}
      </div>

      {/* ── Account-wide usage ───────────────────────────────────────────── */}
      <div>
        <UsageBar
          label="Spaces you own"
          current={plan.usage.bandsOwned}
          limit={plan.limits.bandsOwned}
          note={
            <>
              Spaces you <span className="text-foreground">join</span> are unlimited on every plan
              and never count here.
            </>
          }
        />

        {overrideRaisesLimit && (
          <p className="font-body-tb m-0 mt-3 border-l-2 border-wave-violet pl-3 text-xs leading-5 text-muted-foreground">
            Your account has a guaranteed minimum of{' '}
            <span className="text-foreground">{plan.limits.bandsOwned}</span> owned bands, which
            is more than {def.name} alone would give you. Upgrading or adding spaces raises it
            further.
          </p>
        )}

        {/* An extra_band addon counts on every account now, override or not. */}
        {extraBands > 0 && (
          <p className="font-body-tb m-0 mt-3 border-l-2 border-lime pl-3 text-xs leading-5 text-muted-foreground">
            Includes +{extraBands} from the extra space add-on.
          </p>
        )}

        {bandsTone !== 'lime' && (
          <p className="font-body-tb m-0 mt-3 text-xs leading-5 text-wave-amber">
            You are at or near your owned-space limit. Upgrading raises it; joining someone
            else&rsquo;s space does not need it.
          </p>
        )}
      </div>

      {/* ── Per-band usage ───────────────────────────────────────────────── */}
      {!compact && plan.usage.bands.length > 0 && (
        <div className="mt-5 border-t border-border pt-5">
          <h4 className="font-display-tb m-0 text-base uppercase tracking-normal! text-foreground">
            Per space
          </h4>
          <p className="font-body-tb m-0 mb-4 mt-1 text-xs leading-5 text-muted-foreground">
            Storage is measured per space and is never shared between them — each space gets the
            full {formatMB(plan.limits.storagePerBandMB)}.
          </p>

          <div className="space-y-3">
            {plan.usage.bands.map(band => {
              const extraStorage = unitsFor(plan.addons, 'extra_storage', band.id)
              const extraMembers = unitsFor(plan.addons, 'extra_member', band.id)
              return (
                <div key={band.id} className="border border-border bg-card/50 p-4">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <strong className="font-display-tb m-0 truncate text-sm uppercase tracking-normal! text-foreground">
                      {band.name}
                    </strong>
                    {band.frozen && <FrozenBandChip />}
                  </div>
                  <div className="space-y-4">
                    <UsageBar
                      label="Members"
                      current={band.memberCount}
                      limit={plan.limits.membersPerBand}
                      note={
                        extraMembers > 0
                          ? `Includes +${extraMembers} from the extra member add-on.`
                          : undefined
                      }
                    />
                    <UsageBar
                      label="Storage"
                      current={band.storageBytes}
                      limit={plan.limits.storagePerBandBytes}
                      render={value => formatStorageLimit(value)}
                      note={
                        extraStorage > 0
                          ? `Includes +${formatMB(extraStorage * 10 * 1024)} from the storage add-on.`
                          : undefined
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <p className="font-mono-tb m-0 mt-5 border-t border-border pt-4 text-[9px] uppercase leading-relaxed tracking-[0.18em] text-muted-foreground">
        Active versions ·{' '}
        {plan.limits.activeVersionsPerProject === null
          ? 'Unlimited on this plan'
          : `${plan.limits.activeVersionsPerProject} per project, Master never counts`}
      </p>

      {footer}
    </section>
  )
}

function PlanUsageSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[72, 100, 88, 56].map((width, i) => (
        <div key={i} className="h-4 animate-pulse bg-border" style={{ width: `${width}%` }} />
      ))}
    </div>
  )
}

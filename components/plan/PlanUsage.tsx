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
    <div>
      {/* ── Current plan ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 border border-border bg-surface/40 px-3 py-3">
        <div className="min-w-0">
          <Eyebrow>Your plan</Eyebrow>
          <p className="font-display-tb m-0 mt-2 text-[18px] font-bold uppercase leading-none tracking-tight text-foreground">
            {def.name}
            <span className="ml-2 font-mono-tb text-[10px] font-normal tracking-widest text-muted-foreground">
              {def.price} / month
            </span>
          </p>
        </div>
        {plan.state !== 'active' && (
          <StatusBadge tone={plan.state === 'grace' ? 'amber' : 'destructive'}>
            {plan.state === 'grace' ? `${plan.graceDaysLeft}d grace` : 'Over limit'}
          </StatusBadge>
        )}
      </div>

      {/* ── Account-wide usage ───────────────────────────────────────────── */}
      <div className="mt-4">
        <UsageBar
          label="Bands you own"
          current={plan.usage.bandsOwned}
          limit={plan.limits.bandsOwned}
          note={
            <>
              Bands you <span className="text-foreground">join</span> are unlimited on every plan
              and never count here.
            </>
          }
        />

        {overrideRaisesLimit && (
          <p className="m-0 mt-2 border-l-2 border-[var(--wave-violet)] pl-2.5 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
            Your account has a guaranteed minimum of{' '}
            <span className="text-foreground">{plan.limits.bandsOwned}</span> owned bands, which
            is more than {def.name} alone would give you. Upgrading or adding bands raises it
            further.
          </p>
        )}

        {/* An extra_band addon counts on every account now, override or not. */}
        {extraBands > 0 && (
          <p className="m-0 mt-2 border-l-2 border-lime pl-2.5 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
            Includes +{extraBands} from the extra band add-on.
          </p>
        )}

        {bandsTone !== 'lime' && (
          <p className="m-0 mt-2 font-mono-tb text-[10px] leading-relaxed text-[var(--wave-amber)]">
            You are at or near your owned-band limit. Upgrading raises it; joining someone
            else&rsquo;s band does not need it.
          </p>
        )}
      </div>

      {/* ── Per-band usage ───────────────────────────────────────────────── */}
      {!compact && plan.usage.bands.length > 0 && (
        <div className="mt-6">
          <p className="m-0 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Per band
          </p>
          <p className="m-0 mb-4 mt-2 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
            Storage is measured per band and is never shared between them — each band gets the
            full {formatMB(plan.limits.storagePerBandMB)}.
          </p>

          <div className="space-y-3">
            {plan.usage.bands.map(band => {
              const extraStorage = unitsFor(plan.addons, 'extra_storage', band.id)
              const extraMembers = unitsFor(plan.addons, 'extra_member', band.id)
              return (
                <div key={band.id} className="border border-border bg-card/50 px-3 py-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="m-0 truncate font-mono-tb text-[11px] text-foreground">
                      {band.name}
                    </p>
                    {band.frozen && <FrozenBandChip />}
                  </div>
                  <div className="space-y-3">
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

      {plan.limits.activeVersionsPerProject !== null && (
        <p className="m-0 mt-4 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
          Up to {plan.limits.activeVersionsPerProject} active versions per project. Master never
          counts, and applying a version frees its slot.
        </p>
      )}

      {footer}
    </div>
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

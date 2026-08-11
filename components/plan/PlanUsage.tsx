'use client'

/**
 * Plan display + current usage.
 *
 * The point of this panel is that a user should never be surprised by a limit.
 * Every ceiling they have is listed with what they are currently using against
 * it, and anything within one step of full is called out before they walk into
 * it — a wall you can see coming is a different experience from a wall you hit.
 *
 * Everything rendered here is display. The numbers come from
 * `GET /api/me/plan`, which resolves them server-side; the client never
 * computes a limit and never sends one back.
 */

import { useMemo } from 'react'
import { PLANS, formatMB, type Limit } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import { usePlan } from '@/contexts/PaywallContext'

/** At or above this fraction of a ceiling, say so. */
const NEAR_LIMIT_FRACTION = 0.8

function fraction(current: number, limit: Limit): number | null {
  if (limit === null || limit <= 0) return null
  return current / limit
}

function toneFor(current: number, limit: Limit): 'ok' | 'near' | 'full' {
  const f = fraction(current, limit)
  if (f === null) return 'ok'
  if (f >= 1) return 'full'
  return f >= NEAR_LIMIT_FRACTION ? 'near' : 'ok'
}

const TONE_CLASS = {
  ok: 'bg-lime',
  near: 'bg-[var(--wave-amber)]',
  full: 'bg-destructive',
} as const

function UsageBar({
  label,
  current,
  limit,
  render,
}: {
  label: string
  current: number
  limit: Limit
  render?: (value: number) => string
}) {
  const tone = toneFor(current, limit)
  const f = fraction(current, limit)
  const show = render ?? ((v: number) => String(v))

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span
          className={`font-mono text-[11px] ${
            tone === 'full' ? 'text-destructive' : tone === 'near' ? 'text-[var(--wave-amber)]' : 'text-foreground'
          }`}
        >
          {show(current)}
          <span className="text-muted-foreground">
            {' / '}
            {limit === null ? 'Unlimited' : show(limit)}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-[3px] w-full bg-surface">
        {f !== null && (
          <div
            className={`h-full ${TONE_CLASS[tone]}`}
            style={{ width: `${Math.min(100, Math.round(f * 100))}%` }}
          />
        )}
      </div>
    </div>
  )
}

export function PlanUsage() {
  const plan = usePlan()
  const def = PLANS[plan.plan]

  const bandsNearing = useMemo(
    () => toneFor(plan.usage.bandsOwned, plan.limits.bandsOwned) !== 'ok',
    [plan.usage.bandsOwned, plan.limits.bandsOwned],
  )

  return (
    <div>
      {/* ── Current plan ─────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3 border border-border bg-surface/40 px-3 py-2.5">
        <div className="min-w-0">
          <p className="font-display text-[15px] uppercase tracking-tight text-foreground m-0 leading-none">
            {def.name}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground m-0 mt-1.5">
            {def.price} / month
          </p>
        </div>
        {plan.state !== 'active' && (
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-1 leading-none ${
              plan.state === 'grace'
                ? 'bg-[var(--wave-amber)] text-primary-foreground'
                : 'bg-destructive text-primary-foreground'
            }`}
          >
            {plan.state === 'grace' ? `${plan.graceDaysLeft}d grace` : 'Over limit'}
          </span>
        )}
      </div>

      {/* ── Account-wide usage ───────────────────────────────────────────── */}
      <div className="mt-4">
        <UsageBar
          label="Bands you own"
          current={plan.usage.bandsOwned}
          limit={plan.limits.bandsOwned}
        />
        <p className="font-mono text-[10px] text-muted-foreground m-0 mt-1 leading-relaxed">
          Bands you <em className="not-italic text-foreground">join</em> are unlimited on every
          plan and never count here.
          {plan.bandsOwnedOverridden && ' Your account has a custom allowance.'}
        </p>
        {bandsNearing && (
          <p className="font-mono text-[10px] text-[var(--wave-amber)] m-0 mt-2 leading-relaxed">
            You are at or near your owned-band limit. Upgrading raises it; joining someone
            else&rsquo;s band does not need it.
          </p>
        )}
      </div>

      {/* ── Per-band usage ───────────────────────────────────────────────── */}
      {plan.usage.bands.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground m-0 mb-3">
            Per band
          </p>
          <p className="font-mono text-[10px] text-muted-foreground m-0 mb-3 leading-relaxed">
            Storage is per band and is never shared between them — each band gets the full{' '}
            {formatMB(plan.limits.storagePerBandMB)}.
          </p>

          <div className="space-y-4">
            {plan.usage.bands.map(band => (
              <div key={band.id} className="border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <p className="font-mono text-[11px] text-foreground m-0 truncate">{band.name}</p>
                  {band.frozen && (
                    <span className="font-mono text-[8px] uppercase tracking-[0.18em] bg-destructive text-primary-foreground px-1.5 py-1 leading-none shrink-0">
                      Frozen
                    </span>
                  )}
                </div>
                <UsageBar
                  label="Members"
                  current={band.memberCount}
                  limit={plan.limits.membersPerBand}
                />
                <UsageBar
                  label="Storage"
                  current={band.storageBytes}
                  limit={plan.limits.storagePerBandBytes}
                  render={v => formatStorageLimit(v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.limits.activeVersionsPerProject !== null && (
        <p className="font-mono text-[10px] text-muted-foreground m-0 mt-4 leading-relaxed">
          Up to {plan.limits.activeVersionsPerProject} active versions per project. Master never
          counts, and applying a version frees its slot.
        </p>
      )}
    </div>
  )
}

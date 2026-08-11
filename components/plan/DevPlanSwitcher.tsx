'use client'

/**
 * Development plan switcher.
 *
 * Stripe does not exist, so this is how the plan system gets exercised.
 * Selecting a plan here posts to `POST /api/me/plan` — the REAL flow. It runs
 * the conflict checks, blocks upgrades that need resolving, starts the grace
 * period on a downgrade, and freezes and unfreezes bands. That is the entire
 * point: a switcher that wrote `profiles.plan` directly would prove nothing.
 *
 * The extras below have no user-facing equivalent yet and exist only so the
 * time- and addon-dependent paths are reachable:
 *   · expire grace — pushes `grace_until` into the past so freezing can be
 *     tested without waiting two weeks
 *   · addons       — so extra_band / extra_storage / extra_member resolution
 *     can be seen working
 *   · band_limit override — so the grandfathered-account path is testable
 *
 * ── Gating ──────────────────────────────────────────────────────────────────
 * Rendered only when `DEV_PLAN_TOOLS_AVAILABLE` (NODE_ENV === 'development'),
 * matching the pattern the old paywall toggle used. `next build` sets NODE_ENV
 * to production for every deployment, Vercel previews included. The server
 * route applies the identical test and 404s, so hiding this component is the
 * second line of defence, not the only one.
 */

import { useCallback, useEffect, useState } from 'react'
import { PLAN_ORDER, PLANS, type AddonType, type PlanId } from '@/lib/plans'
import { usePaywall, DEV_PLAN_TOOLS_AVAILABLE } from '@/contexts/PaywallContext'
import type { Conflict } from '@/lib/planConflicts'
import { trackPlanChanged, trackGracePeriodStarted } from '@/lib/planAnalytics'
import { planChangeDirection } from '@/lib/plans'
import { TbButton } from '@/components/design/TbButton'
import { PlanConflictResolver } from '@/components/plan/PlanConflictResolver'

interface AddonRow {
  id: string
  type: AddonType
  bandId: string | null
  quantity: number
}

export function DevPlanSwitcher() {
  const { snapshot: plan, refresh } = usePaywall()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addons, setAddons] = useState<AddonRow[]>([])
  const [pending, setPending] = useState<{
    target: PlanId
    conflicts: Conflict[]
    blocking: Conflict[]
  } | null>(null)

  const [addonType, setAddonType] = useState<AddonType>('extra_band')
  const [addonBandId, setAddonBandId] = useState('')
  const [addonQty, setAddonQty] = useState(1)

  const loadAddons = useCallback(async () => {
    try {
      const res = await fetch('/api/dev/plan')
      if (!res.ok) return
      const data = await res.json()
      setAddons(data.addons ?? [])
    } catch {
      /* dev tool — a failed read is not worth surfacing */
    }
  }, [])

  useEffect(() => {
    if (DEV_PLAN_TOOLS_AVAILABLE) void loadAddons()
  }, [loadAddons])

  const applyPlan = useCallback(
    async (target: PlanId) => {
      setBusy(true)
      setError('')
      try {
        const res = await fetch('/api/me/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: target }),
        })
        const data = await res.json().catch(() => ({}))

        // 409 = the real refusal: blocking conflicts stand. Hand the payload
        // to the resolution screen rather than showing an error.
        if (res.status === 409 && data?.reason === 'conflicts_unresolved') {
          setPending({ target, conflicts: data.conflicts ?? [], blocking: data.blocking ?? [] })
          return
        }
        if (!res.ok) throw new Error(data.error ?? `Plan change failed (${res.status})`)

        const direction = planChangeDirection(data.from, data.to)
        if (direction !== 'none') trackPlanChanged(data.from, data.to, direction)
        if (data.graceStarted) trackGracePeriodStarted(data.to)

        setPending(null)
        await refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const recheck = useCallback(async () => {
    if (!pending) return
    const res = await fetch(`/api/me/plan/conflicts?target=${pending.target}`)
    if (!res.ok) return
    const data = await res.json()
    setPending({ target: pending.target, conflicts: data.conflicts ?? [], blocking: data.blocking ?? [] })
    await refresh()
  }, [pending, refresh])

  const devAction = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      setError('')
      try {
        const res = await fetch('/api/dev/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
        await Promise.all([loadAddons(), refresh()])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setBusy(false)
      }
    },
    [loadAddons, refresh],
  )

  if (!DEV_PLAN_TOOLS_AVAILABLE) return null

  if (pending) {
    return (
      <div className="border border-[var(--wave-amber)]/40 bg-[var(--wave-amber)]/5 p-3">
        <PlanConflictResolver
          targetPlan={pending.target}
          conflicts={pending.conflicts}
          blocking={pending.blocking}
          onRecheck={recheck}
          onConfirm={() => applyPlan(pending.target)}
          onCancel={() => setPending(null)}
          busy={busy}
        />
      </div>
    )
  }

  return (
    <div>
      <p className="font-mono text-[10px] text-muted-foreground m-0 mb-3 leading-relaxed">
        Development only. Selecting a plan runs the real upgrade or downgrade flow — conflict
        checks, grace period, freezing and all.
      </p>

      {/* ── Plan selector ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-px bg-border border border-border">
        {PLAN_ORDER.map(id => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => applyPlan(id)}
            className={`px-2 py-2.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              plan.plan === id
                ? 'bg-lime text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {PLANS[id].name}
          </button>
        ))}
      </div>

      {/* ── Time travel ──────────────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground m-0 mb-2">
          Grace period
        </p>
        <p className="font-mono text-[10px] text-muted-foreground m-0 mb-2 leading-relaxed">
          {plan.graceUntil
            ? `Ends ${new Date(plan.graceUntil).toLocaleString()} · state: ${plan.state}`
            : 'No grace period running.'}
        </p>
        <div className="flex gap-2">
          <TbButton disabled={busy || !plan.graceUntil} onClick={() => devAction({ action: 'expire_grace' })}>
            Expire now
          </TbButton>
          <TbButton disabled={busy || !plan.graceUntil} onClick={() => devAction({ action: 'clear_grace' })}>
            Clear
          </TbButton>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground m-0 mt-2 leading-relaxed">
          Expiring does not freeze anything on its own — freezing is lazy. Open a band afterwards
          and watch it happen there.
        </p>
      </div>

      {/* ── Addons ───────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground m-0 mb-2">
          Addons
        </p>

        {addons.length > 0 && (
          <ul className="m-0 p-0 list-none space-y-1.5 mb-3">
            {addons.map(a => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 border border-border px-2.5 py-1.5"
              >
                <span className="font-mono text-[10px] text-foreground truncate">
                  {a.type} ×{a.quantity}
                  {a.bandId && (
                    <span className="text-muted-foreground">
                      {' · '}
                      {plan.usage.bands.find(b => b.id === a.bandId)?.name ?? a.bandId.slice(0, 8)}
                    </span>
                  )}
                </span>
                <TbButton
                  variant="menuDanger"
                  disabled={busy}
                  onClick={() => devAction({ action: 'revoke_addon', id: a.id })}
                >
                  Revoke
                </TbButton>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={addonType}
            onChange={e => setAddonType(e.target.value as AddonType)}
            className="font-mono text-[10px] bg-background border border-border px-2 py-1.5 text-foreground"
          >
            <option value="extra_band">extra_band</option>
            <option value="extra_storage">extra_storage (+10 GB)</option>
            <option value="extra_member">extra_member</option>
          </select>

          {addonType !== 'extra_band' && (
            <select
              value={addonBandId}
              onChange={e => setAddonBandId(e.target.value)}
              className="font-mono text-[10px] bg-background border border-border px-2 py-1.5 text-foreground max-w-[160px]"
            >
              <option value="">Pick a band…</option>
              {plan.usage.bands.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <input
            type="number"
            min={1}
            value={addonQty}
            onChange={e => setAddonQty(Math.max(1, Number(e.target.value) || 1))}
            className="font-mono text-[10px] bg-background border border-border px-2 py-1.5 text-foreground w-14"
          />

          <TbButton
            variant="primary"
            disabled={busy || (addonType !== 'extra_band' && !addonBandId)}
            onClick={() =>
              devAction({
                action: 'grant_addon',
                addon_type: addonType,
                band_id: addonType === 'extra_band' ? null : addonBandId,
                quantity: addonQty,
              })
            }
          >
            Grant
          </TbButton>
        </div>
      </div>

      {/* ── band_limit override ──────────────────────────────────────────── */}
      <div className="mt-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground m-0 mb-2">
          Grandfathered override
        </p>
        <p className="font-mono text-[10px] text-muted-foreground m-0 mb-2 leading-relaxed">
          `profiles.band_limit` replaces the plan&rsquo;s owned-band limit entirely when set.
          Currently: {plan.bandsOwnedOverridden ? `${plan.limits.bandsOwned} (override)` : 'none'}.
        </p>
        <div className="flex gap-2">
          {[3, 10].map(n => (
            <TbButton
              key={n}
              disabled={busy}
              onClick={() => devAction({ action: 'set_band_limit_override', value: n })}
            >
              Set {n}
            </TbButton>
          ))}
          <TbButton
            disabled={busy}
            onClick={() => devAction({ action: 'set_band_limit_override', value: null })}
          >
            Clear
          </TbButton>
        </div>
      </div>

      {error && <p className="font-mono text-[11px] text-destructive m-0 mt-3">{error}</p>}
      {!plan.provisioned && (
        <p className="font-mono text-[10px] text-[var(--wave-amber)] m-0 mt-3 leading-relaxed">
          The plan schema is not in the database yet — everything here is inert. Run
          supabase/migrations/20260806_subscription_plans.sql first.
        </p>
      )}
    </div>
  )
}

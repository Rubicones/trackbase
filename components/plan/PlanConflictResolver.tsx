'use client'

/**
 * The upgrade resolution screen.
 *
 * Shown when a plan change would leave the account in violation of its own
 * limits. Only member conflicts actually block — an upgrade raises every other
 * ceiling, so bands, storage and versions resolve themselves and are shown
 * here purely as reassurance ("this gets bigger, not smaller").
 *
 * Two rules shape this screen:
 *
 *   1. **Resolve it here.** The realistic case is a free user with three
 *      members moving to Solo, which allows two. Sending them to the members
 *      page to work it out and come back loses the context and the intent, so
 *      removal happens inline, one click, and the list re-checks itself.
 *
 *   2. **Say what happens to the person's work.** Removing someone takes away
 *      their access and nothing else: their comments, tracks and activity all
 *      stay exactly where they are. People genuinely worry about this, and a
 *      screen that stays quiet about it reads like a warning.
 *
 * The confirm button's disabled state is UX. `POST /api/me/plan` re-runs the
 * same check and refuses regardless of what the button was doing.
 */

import { useCallback, useEffect, useState } from 'react'
import { PLANS, formatMB, type PlanId } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import type { Conflict, TooManyMembersConflict } from '@/lib/planConflicts'
import { trackPlanConflictResolved, trackPlanConflictShown } from '@/lib/planAnalytics'
import { TbButton } from '@/components/design/TbButton'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  targetPlan: PlanId
  conflicts: Conflict[]
  blocking: Conflict[]
  onRecheck: () => Promise<void>
  onConfirm: () => Promise<void>
  onCancel: () => void
  busy?: boolean
}

export function PlanConflictResolver({
  targetPlan,
  conflicts,
  blocking,
  onRecheck,
  onConfirm,
  onCancel,
  busy = false,
}: Props) {
  const [removing, setRemoving] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (conflicts.length) trackPlanConflictShown(targetPlan, conflicts.map(c => c.type))
  }, [targetPlan, conflicts])

  const memberConflicts = conflicts.filter(
    (c): c is TooManyMembersConflict => c.type === 'too_many_members',
  )
  const autoResolving = conflicts.filter(c => c.type !== 'too_many_members')

  const removeMember = useCallback(
    async (bandId: string, userId: string) => {
      setRemoving(`${bandId}:${userId}`)
      setError('')
      try {
        const res = await fetch(`/api/bands/${bandId}/members/${userId}`, { method: 'DELETE' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'Could not remove that member')
        }
        trackPlanConflictResolved(targetPlan, 'too_many_members')
        await onRecheck()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setRemoving(null)
      }
    },
    [onRecheck, targetPlan],
  )

  const canConfirm = blocking.length === 0 && !busy

  return (
    <div>
      <p className="font-display text-sm uppercase tracking-tight text-foreground m-0 mb-2">
        Before you switch to {PLANS[targetPlan].name}
      </p>

      {blocking.length > 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground m-0 mb-4 leading-relaxed">
          {PLANS[targetPlan].name} allows fewer members per band than you have right now. Remove
          the extras below and the switch unlocks.
        </p>
      ) : (
        <p className="font-mono text-[11px] text-muted-foreground m-0 mb-4 leading-relaxed">
          Nothing is blocking this switch.
        </p>
      )}

      {/* ── Blocking: too many members ──────────────────────────────────── */}
      {memberConflicts.map(conflict => (
        <div key={conflict.bandId} className="border border-destructive/35 bg-destructive/5 p-3 mb-3">
          <p className="font-mono text-[11px] text-foreground m-0 mb-1">
            {conflict.bandName} — {conflict.current} members, limit {conflict.limit}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground m-0 mb-3 leading-relaxed">
            Remove {conflict.current - conflict.limit}{' '}
            {conflict.current - conflict.limit === 1 ? 'member' : 'members'}. Anything they made
            stays: their comments, tracks and activity history are untouched — they just lose
            access to this band.
          </p>

          <ul className="m-0 p-0 list-none space-y-1.5">
            {conflict.members.map(member => {
              const isOwner = member.role === 'owner'
              const key = `${conflict.bandId}:${member.userId}`
              return (
                <li
                  key={member.userId}
                  className="flex items-center justify-between gap-3 border border-border bg-background px-2.5 py-2"
                >
                  <span className="font-mono text-[11px] text-foreground truncate">
                    {member.displayName || (member.username ? `@${member.username}` : 'Member')}
                    {isOwner && (
                      <span className="text-muted-foreground"> · owner</span>
                    )}
                  </span>
                  {isOwner ? (
                    <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">
                      Stays
                    </span>
                  ) : (
                    <TbButton
                      variant="menuDanger"
                      className="shrink-0"
                      disabled={removing !== null}
                      onClick={() => removeMember(conflict.bandId, member.userId)}
                    >
                      {removing === key ? 'Removing…' : 'Remove'}
                    </TbButton>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {/* ── Non-blocking: shown so the change holds no surprises ────────── */}
      {autoResolving.length > 0 && (
        <div className="border border-border p-3 mb-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground m-0 mb-2">
            Resolves on its own
          </p>
          <ul className="m-0 p-0 list-none space-y-1.5">
            {autoResolving.map((c, i) => (
              <li
                key={i}
                className="font-mono text-[10px] text-muted-foreground leading-relaxed flex items-start gap-2"
              >
                <span className="mt-[6px] size-1 bg-lime shrink-0" aria-hidden />
                <span>{describeAutoResolving(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="font-mono text-[11px] text-destructive m-0 mb-3">{error}</p>}

      <div className="flex gap-2 justify-end pt-1">
        <TbButton onClick={onCancel} disabled={busy}>
          Cancel
        </TbButton>
        <TbButton variant="primary" onClick={onConfirm} disabled={!canConfirm}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size={11} tone="muted" /> Switching…
            </span>
          ) : (
            `Switch to ${PLANS[targetPlan].name}`
          )}
        </TbButton>
      </div>
    </div>
  )
}

function describeAutoResolving(c: Conflict): string {
  switch (c.type) {
    case 'too_many_bands':
      return `You own ${c.current} bands; the new plan allows ${c.limit}. Nothing is deleted — you get 14 days to decide, and bands over the limit keep working until then.`
    case 'storage_exceeded':
      return `${c.bandName} is using ${formatStorageLimit(c.currentMB * 1024 * 1024)} of ${formatMB(c.limitMB)}. Existing files stay; new uploads to that band are paused until it fits.`
    case 'versions_exceeded':
      return `${c.projectName} has ${c.current} active versions; the new plan allows ${c.limit}. Existing versions stay; new ones are paused in that project.`
    case 'too_many_members':
      return `${c.bandName} has ${c.current} members, limit ${c.limit}.`
  }
}

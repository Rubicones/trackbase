'use client'

/**
 * The upgrade resolution screen.
 *
 * Rebuilt on the subscription design kit ("Conflict resolver"): blocking
 * conflicts on one side, the outcomes that resolve themselves on the other, so
 * a user can see at a glance which half needs them.
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
import { CircleCheck } from 'lucide'
import { PLANS, formatMB, type PlanId } from '@/lib/plans'
import { formatStorageLimit } from '@/lib/bandStorage'
import type { Conflict, TooManyMembersConflict } from '@/lib/planConflicts'
import { trackPlanConflictResolved, trackPlanConflictShown } from '@/lib/planAnalytics'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbButton } from '@/components/design/TbButton'
import { Spinner } from '@/components/ui/Spinner'
import { Eyebrow, InlineNotice, StatusBadge } from '@/components/plan/ui'

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
    <section className="border border-border bg-surface/40">
      <header className="border-b border-border px-4 py-4">
        <Eyebrow>Plan conflict resolver</Eyebrow>
        <h3 className="font-display-tb m-0 mt-2 text-xl font-bold uppercase tracking-tight text-foreground">
          Before you switch to {PLANS[targetPlan].name}
        </h3>
        <p className="m-0 mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
          {blocking.length > 0
            ? `${PLANS[targetPlan].name} allows fewer members per space than you have right now. Remove the extras below and the switch unlocks.`
            : 'Nothing is blocking this switch.'}
        </p>
      </header>

      <div className="grid lg:grid-cols-2">
        {/* ── Blocking: too many members ──────────────────────────────────── */}
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <StatusBadge tone={blocking.length > 0 ? 'destructive' : 'lime'}>
            {blocking.length > 0 ? 'Blocking · too many members' : 'Ready'}
          </StatusBadge>

          {memberConflicts.length === 0 && (
            <p className="m-0 mt-4 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
              No space is over the member limit of the plan you are moving to.
            </p>
          )}

          {memberConflicts.map(conflict => (
            <div key={conflict.bandId} className="mt-4">
              <h4 className="font-display-tb m-0 text-[14px] font-bold uppercase tracking-tight text-foreground">
                {conflict.bandName}{' '}
                <span className="font-mono-tb text-[10px] font-normal text-muted-foreground">
                  {conflict.current} / {conflict.limit}
                </span>
              </h4>
              <p className="m-0 mt-1.5 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
                Remove {conflict.current - conflict.limit}{' '}
                {conflict.current - conflict.limit === 1 ? 'member' : 'members'}. Anything they
                made stays: their comments, tracks and activity history are untouched — they just
                lose access to this space.
              </p>

              <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                {conflict.members.map(member => {
                  const isOwner = member.role === 'owner'
                  const key = `${conflict.bandId}:${member.userId}`
                  return (
                    <li
                      key={member.userId}
                      className="flex items-center justify-between gap-3 border border-border bg-background px-2.5 py-2"
                    >
                      <span className="truncate font-mono-tb text-[11px] text-foreground">
                        {member.displayName || (member.username ? `@${member.username}` : 'Member')}
                        {isOwner && <span className="text-muted-foreground"> · owner</span>}
                      </span>
                      {isOwner ? (
                        <span className="shrink-0 font-mono-tb text-[9px] uppercase tracking-widest text-muted-foreground">
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
        </div>

        {/* ── Non-blocking: shown so the change holds no surprises ────────── */}
        <div className="p-4">
          <Eyebrow tone="amber">Resolves on its own</Eyebrow>
          {autoResolving.length === 0 ? (
            <p className="m-0 mt-4 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
              Nothing else changes shape on this switch.
            </p>
          ) : (
            <ul className="m-0 mt-4 list-none space-y-3 p-0">
              {autoResolving.map((c, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 font-mono-tb text-[10px] leading-relaxed text-muted-foreground"
                >
                  <span className="mt-px shrink-0 text-wave-amber">
                    <LucideIcon icon={CircleCheck} size={13} />
                  </span>
                  <span>{describeAutoResolving(c)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 pb-1">
          <InlineNotice title={error} />
        </div>
      )}

      <footer className="flex justify-end gap-2 border-t border-border p-3">
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
      </footer>
    </section>
  )
}

function describeAutoResolving(c: Conflict): string {
  switch (c.type) {
    case 'too_many_bands':
      return `You own ${c.current} spaces; the new plan allows ${c.limit}. Nothing is deleted — you get 14 days to decide, and bands over the limit keep working until then.`
    case 'storage_exceeded':
      return `${c.bandName} is using ${formatStorageLimit(c.currentMB * 1024 * 1024)} of ${formatMB(c.limitMB)}. Existing files stay; new uploads to that band are paused until it fits.`
    case 'versions_exceeded':
      return `${c.projectName} has ${c.current} active versions; the new plan allows ${c.limit}. Existing versions stay; new ones are paused in that project.`
    case 'too_many_members':
      return `${c.bandName} has ${c.current} members, limit ${c.limit}.`
  }
}

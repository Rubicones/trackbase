'use client'

/**
 * Frozen-band notice.
 *
 * Rebuilt on the subscription design kit ("Grace & frozen states"). The copy
 * discipline is unchanged, because it is the part that matters: a frozen band
 * is a plan state, not a penalty, and the person looking at it may not even be
 * the person who downgraded — a member seeing their band suddenly read-only
 * needs to know immediately that their work is safe.
 *
 * So the first thing it says is that nothing was deleted, and the second is
 * exactly what unfreezes it. There is no "contact support", no ambiguity about
 * whether files are being held, and no countdown: unfreezing is immediate and
 * automatic once the owner is back within their limit.
 *
 * Presentation only. Writes are refused server-side on every endpoint whether
 * this renders or not (`requireBandMember` blocks by HTTP method).
 */

import { useEffect } from 'react'
import { LockKeyhole } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import { usePaywall, usePlanTracking } from '@/contexts/PaywallContext'
import { trackBandFrozen } from '@/lib/planAnalytics'
import { actionDestructive } from '@/components/plan/ui'
import { Eyebrow, StatusBadge } from '@/components/plan/ui'

export function FrozenBandBanner({
  reason = 'plan_downgrade',
  isOwner,
}: {
  reason?: string | null
  isOwner: boolean
}) {
  const { openPaywall } = usePaywall()
  const track = usePlanTracking()

  useEffect(() => {
    trackBandFrozen(reason ?? 'plan_downgrade')
  }, [reason])

  return (
    // The kit stacks this one rather than putting the button beside the copy,
    // and fills it destructive rather than lime: a frozen band is not an
    // upsell opportunity dressed in the accent colour, it is a red state with
    // one way out.
    <section className="border border-destructive/45 bg-destructive/[0.07] p-5">
      <Eyebrow tone="destructive">This space is frozen</Eyebrow>

      <p className="font-body-tb m-0 mt-3 text-sm leading-6 text-foreground">
        <strong className="font-bold">Nothing has been deleted.</strong> Every track, comment,
        version and file is exactly where it was, and you can still listen, browse and download
        all of it. What&rsquo;s paused is writing: uploads, recording, new versions, structure
        edits, chat and adding members.
      </p>

      <p className="font-body-tb m-0 mt-2 text-sm leading-6 text-muted-foreground">
        {isOwner ? (
          <>
            It froze because your plan no longer covers this many spaces. Upgrade, or delete
            enough other spaces to fit your limit — either one unfreezes it immediately, with
            nothing to restore.
          </>
        ) : (
          <>
            It froze because the space owner&rsquo;s plan no longer covers this many spaces. When
            they upgrade — or free up a slot — it comes back immediately, exactly as it is now.
          </>
        )}
      </p>

      {isOwner && (
        <button
          type="button"
          className={`${actionDestructive} mt-4`}
          onClick={() => {
            track('plan_cta_clicked', { source: 'frozen_space', cta: 'see_plans' })
            openPaywall('limit')
          }}
        >
          See plans
        </button>
      )}
    </section>
  )
}

/** Compact inline marker, for lists where the full banner would not fit. */
export function FrozenBandChip() {
  return (
    <StatusBadge tone="destructive">
      <LucideIcon icon={LockKeyhole} size={9} />
      Frozen
    </StatusBadge>
  )
}

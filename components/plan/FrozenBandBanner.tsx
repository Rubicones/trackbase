'use client'

/**
 * Frozen-band notice.
 *
 * Unmistakable, but not punitive. A frozen band is a plan state, not a
 * penalty, and the person looking at it may not even be the person who
 * downgraded — a member seeing their band suddenly read-only needs to know
 * immediately that their work is safe.
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
import { usePaywall } from '@/contexts/PaywallContext'
import { trackBandFrozen } from '@/lib/planAnalytics'
import { TbButton } from '@/components/design/TbButton'

export function FrozenBandBanner({
  reason = 'plan_downgrade',
  isOwner,
}: {
  reason?: string | null
  isOwner: boolean
}) {
  const { openPaywall } = usePaywall()

  useEffect(() => {
    trackBandFrozen(reason ?? 'plan_downgrade')
  }, [reason])

  return (
    <div className="border border-destructive/40 bg-destructive/5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[13px] uppercase tracking-tight text-destructive m-0">
            This band is frozen
          </p>
          <p className="font-mono text-[11px] text-muted-foreground m-0 mt-1.5 leading-relaxed">
            <span className="text-foreground">Nothing has been deleted.</span> Every track,
            comment, version and file is exactly where it was, and you can still listen, browse
            and download all of it. What&rsquo;s paused is writing: uploads, recording, new
            versions, structure edits, chat and adding members.
          </p>
          <p className="font-mono text-[11px] text-muted-foreground m-0 mt-2 leading-relaxed">
            {isOwner ? (
              <>
                It froze because your plan no longer covers this many bands. Upgrade, or delete
                enough other bands to fit your limit — either one unfreezes it immediately, with
                nothing to restore.
              </>
            ) : (
              <>
                It froze because the band owner&rsquo;s plan no longer covers this many bands.
                When they upgrade — or free up a slot — it comes back immediately, exactly as it
                is now.
              </>
            )}
          </p>
        </div>

        {isOwner && (
          <TbButton variant="primary" className="shrink-0" onClick={() => openPaywall('limit')}>
            See plans
          </TbButton>
        )}
      </div>
    </div>
  )
}

/** Compact inline marker, for lists where the full banner would not fit. */
export function FrozenBandChip() {
  return (
    <span className="font-mono text-[8px] uppercase tracking-[0.18em] bg-destructive text-primary-foreground px-1.5 py-1 leading-none">
      Frozen
    </span>
  )
}

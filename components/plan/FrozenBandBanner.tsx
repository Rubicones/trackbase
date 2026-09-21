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
import { usePaywall } from '@/contexts/PaywallContext'
import { trackBandFrozen } from '@/lib/planAnalytics'
import { TbButton } from '@/components/design/TbButton'
import { Eyebrow, StatusBadge } from '@/components/plan/ui'

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
    <section className="border border-destructive/40 bg-destructive/[0.06] px-4 py-4">
      {/* See the note in GraceBanner: a basis, not just grow, or the copy
          collapses into a one-word column beside the button. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 grow basis-72">
          <Eyebrow tone="destructive">This band is frozen</Eyebrow>

          <p className="m-0 mt-3 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-foreground">Nothing has been deleted.</span> Every track,
            comment, version and file is exactly where it was, and you can still listen, browse
            and download all of it. What&rsquo;s paused is writing: uploads, recording, new
            versions, structure edits, chat and adding members.
          </p>

          <p className="m-0 mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
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
          <TbButton variant="primary" onClick={() => openPaywall('limit')}>
            See plans
          </TbButton>
        )}
      </div>
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

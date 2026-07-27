'use client'

import { useState } from 'react'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'

/** data-tour target — the new-user feedback hint spotlights this button. */
export const FEEDBACK_LAUNCHER_TOUR_ID = 'feedback-launcher'

/**
 * Footer status-bar trigger for the feedback / bug report modal.
 * Matches the caps-style typography of the surrounding status-bar items
 * (e.g. "SYS OK") but is deliberately accent-coloured: reports and improvement
 * ideas are the one footer action we actively want people to notice.
 */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        data-tour={FEEDBACK_LAUNCHER_TOUR_ID}
        onClick={() => setOpen(true)}
        title="Feedback & Bug Report"
        className="inline-block text-[10px] uppercase tracking-widest text-lime hover:text-foreground transition-colors"
      >
        Feedback &amp; Report
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}

'use client'

import { useState } from 'react'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'

/**
 * Footer status-bar trigger for the feedback / bug report modal.
 * Matches the caps-style typography and hover treatment of the surrounding
 * status-bar items (e.g. "SYS OK"). The short "FEEDBACK" label keeps the
 * footer's text density; the full phrase lives in the tooltip.
 */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Feedback & Bug Report"
        className="inline-block text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime transition-colors"
      >
        Feedback &amp; Report
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  )
}

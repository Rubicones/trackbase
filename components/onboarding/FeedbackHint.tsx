'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { trackEvent } from '@/lib/analytics'
import { TbButton } from '@/components/design/TbButton'
import { FEEDBACK_LAUNCHER_TOUR_ID } from '@/components/feedback/FeedbackLauncher'

/**
 * One-shot spotlight on the footer "Feedback & Report" button, shown right
 * after a brand-new user closes their first welcome modal.
 *
 * Deliberately lighter than `ProjectTour`: a single target, no step sequence,
 * no progress bar — but the visual language (lime ring + huge outer shadow,
 * popover card) is the same so the two read as one system.
 *
 * Nothing here captures pointer events except the card itself: the whole point
 * of the hint is that the user can click the button it is pointing at.
 *
 * Only ever rendered in response to a click, so there is no SSR/hydration pass
 * to guard the portal against.
 */

const CARD_W = 300
const CARD_H_ESTIMATE = 190
const PAD = 6
const GAP = 12
const POLL_MS = 60
const MAX_POLLS = 12

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export function FeedbackHint({ onDismiss }: { onDismiss: () => void }) {
  const [rect, setRect] = useState<Rect | null>(null)

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tour="${FEEDBACK_LAUNCHER_TOUR_ID}"]`)
    if (!el) return false
    const r = el.getBoundingClientRect()
    setRect({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    })
    return true
  }, [])

  // Poll rather than measuring inline: the footer is part of the page shell and
  // is normally already mounted, but a slow first paint would otherwise leave
  // the card floating with no ring. Gives up quietly after MAX_POLLS.
  useEffect(() => {
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      if (measure() || tries >= MAX_POLLS) window.clearInterval(id)
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [measure])

  useEffect(() => {
    const onReflow = () => { measure() }
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [measure])

  useEffect(() => {
    trackEvent('feedback_hint_shown')
  }, [])

  const dismiss = useCallback(() => {
    trackEvent('feedback_hint_dismissed')
    onDismiss()
  }, [onDismiss])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  if (!rect) return null

  const cardTop = Math.max(8, rect.top - GAP - CARD_H_ESTIMATE)
  const cardLeft = Math.max(
    8,
    Math.min(
      window.innerWidth - CARD_W - 8,
      rect.left + rect.width / 2 - CARD_W / 2,
    ),
  )

  return createPortal(
    <>
      <div
        className="fixed pointer-events-none z-[301] border-2 border-lime"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        }}
      />
      <div
        role="dialog"
        aria-label="Feedback and report"
        className="fixed z-[302] border border-border bg-popover shadow-2xl p-4 animate-slide-in"
        style={{ top: cardTop, left: cardLeft, width: CARD_W }}
      >
        <div className="text-[10px] uppercase tracking-widest text-lime mb-2">
          One last thing
        </div>
        <h2 className="font-display text-base uppercase tracking-tight text-foreground m-0 mb-2 leading-snug">
          Tell us what to fix
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-4">
          sonicdesk is in beta and we read everything. Hit{' '}
          <span className="text-lime">Feedback &amp; Report</span> down here any
          time something breaks, feels wrong, or you have an idea that would make
          it better for your band.
        </p>
        <div className="flex justify-end">
          <TbButton variant="primary" onClick={dismiss}>
            Got it
          </TbButton>
        </div>
      </div>
    </>,
    document.body,
  )
}

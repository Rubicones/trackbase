'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
const PAD = 6
const GAP = 12
const EDGE = 8
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

  /**
   * The card's real height, measured rather than guessed.
   *
   * This used to be a 190px constant, which is where the clipping came from:
   * the copy wraps to a different number of lines at every width, so on a
   * narrow viewport the card is far taller than the estimate. Positioning
   * `top` from a too-small height pushed the card down past the button and off
   * the bottom of the screen, cutting off the "Got it" button — the one control
   * that dismisses it.
   *
   * Null until the ResizeObserver's first callback, and the card stays
   * `visibility: hidden` until then so it is never painted at the wrong place.
   */
  const [cardH, setCardH] = useState<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

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

  // Measured via ResizeObserver rather than a one-off read: the card's height
  // changes when the viewport reflows the copy, and the observer's initial
  // callback covers the first measurement too.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight
      if (h > 0) setCardH(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [rect])

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

  // Always above the button (it lives in the footer, so there is room), and
  // clamped so the card can never run off either end of the viewport.
  const measuredH = cardH ?? 0
  const cardTop = Math.min(
    Math.max(EDGE, rect.top - GAP - measuredH),
    Math.max(EDGE, window.innerHeight - measuredH - EDGE),
  )
  const cardLeft = Math.max(
    EDGE,
    Math.min(
      window.innerWidth - CARD_W - EDGE,
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
        ref={cardRef}
        role="dialog"
        aria-label="Feedback and report"
        className="fixed z-[302] border border-border bg-popover shadow-2xl p-4 animate-slide-in"
        style={{
          top: cardTop,
          left: cardLeft,
          width: CARD_W,
          // Hidden, not unmounted: it has to be in the DOM to be measured.
          visibility: cardH === null ? 'hidden' : undefined,
        }}
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

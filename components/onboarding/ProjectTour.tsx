'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { trackEvent } from '@/lib/analytics'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { TbButton } from '@/components/design/TbButton'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TourStep {
  target: string | null   // data-tour value; null = full-dim, card centered
  title: string
  body: string
  /** When set, Next stays disabled until this returns true (e.g. user switches tab). */
  gate?: () => boolean
  gateHint?: string
}

type Placement = 'above' | 'below' | 'left' | 'right' | 'center'

interface SpotlightState {
  top: number
  left: number
  width: number
  height: number
}

interface CardState {
  top: number
  left: number
  placement: Placement
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const ALL_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to {PROJECT_NAME}',
    body: "Let's take a quick look around. This will only take a minute — or skip if you'd rather explore on your own.",
  },
  {
    target: 'add-track-row',
    title: 'Upload your tracks',
    body: 'Drag and drop WAV, MP3, or MIDI files here — or click to browse. Each instrument becomes its own track with its own waveform.',
  },
  {
    target: 'record-track-button',
    title: 'Record a take',
    body: 'Click Record track to add a live recording row. Arm it from the row, hit record in the transport, and capture audio straight into the project — same as adding an uploaded file when you save.',
  },
  {
    target: 'versions-sidebar',
    title: 'Versions are your save points',
    body: "'Master' is your main version. Want to try re-recording a part without affecting Master? Create a new version — it starts as an exact copy, and you can apply your changes back at any time.",
  },
  {
    target: 'new-branch-button',
    title: 'Create a version to experiment',
    body: 'Click here to create a new version. Change a track, update the structure, leave a comment — anything you do in a version stays separate from Master until you decide to apply it.',
  },
  {
    target: 'save-version-button',
    title: 'Bring changes together',
    body: "When you're happy with a version, apply it to Master. If both versions changed the same thing, you'll see a clear side-by-side comparison to choose from.",
  },
  {
    target: 'edit-structure-button',
    title: 'Map out your song',
    body: "Mark out intro, verses, choruses, and more — synced to your song's bars. Add the chords for each section so you never forget them at rehearsal.",
  },
  {
    target: 'comments-toggle',
    title: 'Leave notes for the band',
    body: 'Turn on comment mode and click-drag across any waveform to mark a section. Perfect for "redo this bit" or "love this take" — everyone in the band can see it.',
  },
  {
    target: 'resources-card',
    title: 'Keep everything in one place',
    body: 'Click Resources to attach lyrics, DAW project files, reference links — anything related to this song. Everything stays in one place for the whole band.',
  },
  {
    target: 'chat-launcher',
    title: 'Band chat',
    body: 'Open chat from the edge tab to message the band, @mention teammates, and link versions or time ranges on a track — everyone stays in sync without leaving the project.',
  },
  {
    target: 'share-button',
    title: 'Share with your band',
    body: 'Anyone in your band can open this link. Export WAV when you need the full mix or individual stems.',
  },
]

const CARD_W = 340
const CARD_PADDING = 8   // breathing room around the spotlight element
const CARD_GAP = 14      // gap between spotlight and card

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findTarget(name: string): Element | null {
  return document.querySelector(`[data-tour="${name}"]`)
}

async function resolveTarget(name: string | null, retries = 3, delayMs = 100): Promise<Element | null> {
  if (name === null) return null
  for (let i = 0; i <= retries; i++) {
    const el = findTarget(name)
    if (el) return el
    if (i < retries) await new Promise(r => setTimeout(r, delayMs))
  }
  return null
}

function computeCardPlacement(
  spotlight: SpotlightState,
  cardEstimatedH: number,
): CardState {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const spaceAbove = spotlight.top - CARD_PADDING
  const spaceBelow = vh - (spotlight.top + spotlight.height + CARD_PADDING)
  const spaceLeft = spotlight.left - CARD_PADDING
  const spaceRight = vw - (spotlight.left + spotlight.width + CARD_PADDING)

  let placement: Placement
  if (spaceBelow >= cardEstimatedH + CARD_GAP) {
    placement = 'below'
  } else if (spaceAbove >= cardEstimatedH + CARD_GAP) {
    placement = 'above'
  } else if (spaceRight >= CARD_W + CARD_GAP) {
    placement = 'right'
  } else if (spaceLeft >= CARD_W + CARD_GAP) {
    placement = 'left'
  } else {
    placement = 'below'
  }

  let top = 0
  let left = 0

  switch (placement) {
    case 'below':
      top = spotlight.top + spotlight.height + CARD_PADDING + CARD_GAP
      left = Math.max(8, Math.min(vw - CARD_W - 8, spotlight.left + spotlight.width / 2 - CARD_W / 2))
      break
    case 'above':
      top = spotlight.top - CARD_PADDING - CARD_GAP - cardEstimatedH
      left = Math.max(8, Math.min(vw - CARD_W - 8, spotlight.left + spotlight.width / 2 - CARD_W / 2))
      break
    case 'right':
      left = spotlight.left + spotlight.width + CARD_PADDING + CARD_GAP
      top = Math.max(8, Math.min(vh - cardEstimatedH - 8, spotlight.top + spotlight.height / 2 - cardEstimatedH / 2))
      break
    case 'left':
      left = spotlight.left - CARD_PADDING - CARD_GAP - CARD_W
      top = Math.max(8, Math.min(vh - cardEstimatedH - 8, spotlight.top + spotlight.height / 2 - cardEstimatedH / 2))
      break
  }

  top = Math.max(8, Math.min(vh - cardEstimatedH - 8, top))
  left = Math.max(8, Math.min(vw - CARD_W - 8, left))

  return { top, left, placement }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ProjectTourProps {
  projectName: string
  show: boolean
  steps?: TourStep[]
  onFinish: () => void
  onSkip: () => void
}

export function ProjectTour({ projectName, show, steps = ALL_STEPS, onFinish, onSkip }: ProjectTourProps) {
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null)
  const [card, setCard] = useState<CardState | null>(null)
  const [mounted, setMounted] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [gateOpen, setGateOpen] = useState(true)
  const cardRef = useRef<HTMLDivElement>(null)
  const tourStartedRef = useRef(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!show) {
      tourStartedRef.current = false
      return
    }
    if (!tourStartedRef.current) {
      tourStartedRef.current = true
      trackEvent('tour_started')
    }
    setStepIndex(0)
  }, [show])

  useEffect(() => {
    if (!show) return
    setVisibleSteps(steps)
  }, [show, steps])

  const goToStep = useCallback(async (idx: number, steps: TourStep[]) => {
    if (idx >= steps.length) return
    setTransitioning(true)

    const step = steps[idx]

    if (step.target === null) {
      setSpotlight(null)
      setCard({ top: window.innerHeight / 2 - 150, left: window.innerWidth / 2 - CARD_W / 2, placement: 'center' })
      setTransitioning(false)
      return
    }

    const el = await resolveTarget(step.target)
    if (!el) {
      const newSteps = steps.filter((_, i) => i !== idx)
      setVisibleSteps(newSteps)
      await goToStep(idx, newSteps)
      return
    }

    el.scrollIntoView({
      behavior: 'smooth',
      block: step.target.startsWith('mobile-') ? 'nearest' : 'center',
    })
    await new Promise(r => setTimeout(r, 320))

    const rect = el.getBoundingClientRect()
    const sp: SpotlightState = {
      top: rect.top - CARD_PADDING,
      left: rect.left - CARD_PADDING,
      width: rect.width + CARD_PADDING * 2,
      height: rect.height + CARD_PADDING * 2,
    }
    setSpotlight(sp)

    const estH = 220
    const cardPos = computeCardPlacement(sp, estH)
    setCard(cardPos)
    setTransitioning(false)
  }, [])

  useEffect(() => {
    if (!show || visibleSteps.length === 0) return
    goToStep(stepIndex, visibleSteps)
  }, [show, stepIndex, visibleSteps, goToStep])

  useEffect(() => {
    if (!spotlight || !cardRef.current) return
    const actualH = cardRef.current.offsetHeight
    const refined = computeCardPlacement(spotlight, actualH)
    setCard(prev => {
      if (!prev) return refined
      if (Math.abs(prev.top - refined.top) < 2 && Math.abs(prev.left - refined.left) < 2) return prev
      return refined
    })
  })

  useEffect(() => {
    if (!show) return
    function handleResize() {
      goToStep(stepIndex, visibleSteps)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [show, stepIndex, visibleSteps, goToStep])

  useEffect(() => {
    const step = visibleSteps[stepIndex]
    if (!show || !step?.gate) {
      setGateOpen(true)
      return
    }
    const tick = () => setGateOpen(step.gate!())
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [show, stepIndex, visibleSteps])

  const handleNext = useCallback(() => {
    const step = visibleSteps[stepIndex]
    if (step?.gate && !step.gate()) return
    if (stepIndex < visibleSteps.length - 1) {
      setStepIndex(i => i + 1)
    } else {
      trackEvent('tour_completed')
      onFinish()
    }
  }, [stepIndex, visibleSteps, onFinish])

  const handleBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex(i => i - 1)
  }, [stepIndex])

  const handleSkip = useCallback(() => {
    trackEvent('tour_skipped', { at_step: stepIndex + 1 })
    onSkip()
  }, [onSkip, stepIndex])

  if (!mounted || !show) return null

  const currentStep = visibleSteps[stepIndex]
  if (!currentStep) return null

  const totalSteps = visibleSteps.length
  const displayStep = stepIndex + 1
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1
  const showSkip = stepIndex <= 1
  const isGated = Boolean(currentStep.gate && !gateOpen)

  const title = currentStep.title.replace('{PROJECT_NAME}', projectName)
  const isCenter = currentStep.target === null

  return createPortal(
    <>
      {/* Backdrop / spotlight */}
      {isCenter ? (
        <div className="fixed inset-0 z-[300] bg-background/80 backdrop-blur-sm pointer-events-none" />
      ) : spotlight ? (
        <div
          className="fixed pointer-events-none z-[301] border-2 border-lime"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            transition: 'top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease',
          }}
        />
      ) : null}

      {/* Click-capture layer — gated steps let the user interact with highlighted UI */}
      <div className={`fixed inset-0 z-[300] cursor-default ${isGated ? 'pointer-events-none' : ''}`} />

      {/* Tour card */}
      {card && (
        <div
          ref={cardRef}
          className="fixed z-[302] border border-border bg-popover shadow-2xl p-5 animate-slide-in pointer-events-auto"
          style={{
            top: card.top,
            left: card.left,
            width: CARD_W,
            transition: 'top 0.25s ease, left 0.25s ease',
          }}
        >
          {!isCenter && (
            <Caret
              placement={card.placement}
              spotlight={spotlight}
              cardLeft={card.left}
              cardTop={card.top}
              cardW={CARD_W}
            />
          )}

          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Step {displayStep} of {totalSteps}
            </span>
            <button
              type="button"
              onClick={handleSkip}
              className="size-7 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-lime hover:text-lime transition shrink-0"
              title="Close tour"
              aria-label="Close tour"
            >
              <XIcon />
            </button>
          </div>

          {/* Title */}
          <h2 className="font-display text-base uppercase tracking-tight text-foreground m-0 mb-2 leading-snug">
            {title}
          </h2>

          {/* Body */}
          <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-4">
            {currentStep.body}
          </p>

          {/* Progress bar */}
          <div className="flex gap-0.5 mb-5" role="progressbar" aria-valuenow={displayStep} aria-valuemin={1} aria-valuemax={totalSteps}>
            {visibleSteps.map((_, i) => (
              <div
                key={i}
                className={`h-0.5 flex-1 transition-colors ${
                  i === stepIndex ? 'bg-lime' : i < stepIndex ? 'bg-foreground/35' : 'bg-border'
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            {showSkip && (
              <TbButton variant="link" className="mr-auto" onClick={handleSkip}>
                Skip tour
              </TbButton>
            )}
            {!isFirst && (
              <TbButton onClick={handleBack}>Back</TbButton>
            )}
            <TbButton variant="primary" onClick={handleNext} disabled={transitioning || isGated}>
              {isGated
                ? (currentStep.gateHint ?? 'Complete the step above')
                : isFirst
                  ? 'Start'
                  : isLast
                    ? 'Finish'
                    : 'Next'}
            </TbButton>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}

// ─── Caret ────────────────────────────────────────────────────────────────────

function Caret({ placement, spotlight, cardLeft, cardTop, cardW }: {
  placement: Placement
  spotlight: SpotlightState | null
  cardLeft: number
  cardTop: number
  cardW: number
}) {
  if (!spotlight || placement === 'center') return null

  const CARET = 7
  const style: React.CSSProperties = { position: 'absolute', width: 0, height: 0 }
  const fill = 'var(--popover)'
  const stroke = 'var(--border)'

  if (placement === 'below') {
    const anchorX = spotlight.left + spotlight.width / 2
    const caretX = Math.max(CARET, Math.min(cardW - CARET * 2, anchorX - cardLeft))
    return (
      <>
        <div style={{
          ...style,
          top: -CARET,
          left: caretX,
          borderLeft: `${CARET}px solid transparent`,
          borderRight: `${CARET}px solid transparent`,
          borderBottom: `${CARET}px solid ${stroke}`,
        }} />
        <div style={{
          ...style,
          top: -CARET + 1,
          left: caretX + 1,
          borderLeft: `${CARET - 1}px solid transparent`,
          borderRight: `${CARET - 1}px solid transparent`,
          borderBottom: `${CARET - 1}px solid ${fill}`,
        }} />
      </>
    )
  }

  if (placement === 'above') {
    const anchorX = spotlight.left + spotlight.width / 2
    const caretX = Math.max(CARET, Math.min(cardW - CARET * 2, anchorX - cardLeft))
    return (
      <>
        <div style={{
          ...style,
          bottom: -CARET,
          left: caretX,
          borderLeft: `${CARET}px solid transparent`,
          borderRight: `${CARET}px solid transparent`,
          borderTop: `${CARET}px solid ${stroke}`,
        }} />
        <div style={{
          ...style,
          bottom: -CARET + 1,
          left: caretX + 1,
          borderLeft: `${CARET - 1}px solid transparent`,
          borderRight: `${CARET - 1}px solid transparent`,
          borderTop: `${CARET - 1}px solid ${fill}`,
        }} />
      </>
    )
  }

  if (placement === 'right') {
    const anchorY = spotlight.top + spotlight.height / 2
    const top = Math.max(CARET, anchorY - cardTop - CARET)
    return (
      <>
        <div style={{
          ...style,
          left: -CARET,
          top,
          borderTop: `${CARET}px solid transparent`,
          borderBottom: `${CARET}px solid transparent`,
          borderRight: `${CARET}px solid ${stroke}`,
        }} />
        <div style={{
          ...style,
          left: -CARET + 1,
          top: top + 1,
          borderTop: `${CARET - 1}px solid transparent`,
          borderBottom: `${CARET - 1}px solid transparent`,
          borderRight: `${CARET - 1}px solid ${fill}`,
        }} />
      </>
    )
  }

  if (placement === 'left') {
    const anchorY = spotlight.top + spotlight.height / 2
    const top = Math.max(CARET, anchorY - cardTop - CARET)
    return (
      <>
        <div style={{
          ...style,
          right: -CARET,
          top,
          borderTop: `${CARET}px solid transparent`,
          borderBottom: `${CARET}px solid transparent`,
          borderLeft: `${CARET}px solid ${stroke}`,
        }} />
        <div style={{
          ...style,
          right: -CARET + 1,
          top: top + 1,
          borderTop: `${CARET - 1}px solid transparent`,
          borderBottom: `${CARET - 1}px solid transparent`,
          borderLeft: `${CARET - 1}px solid ${fill}`,
        }} />
      </>
    )
  }

  return null
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ─── Help button (exported separately for use in topbar) ─────────────────────

export function TourHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <HoverTooltip label="Restart tour" placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label="Restart tour"
        className="size-8 border border-border bg-surface-2 grid place-items-center text-foreground hover:border-lime transition"
      >
        <span className="text-[11px] leading-none" aria-hidden>?</span>
      </button>
    </HoverTooltip>
  )
}

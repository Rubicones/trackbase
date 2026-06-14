'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourStep {
  target: string | null   // data-tour value; null = full-dim, card centered
  title: string
  body: string
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
    target: 'versions-sidebar',
    title: 'Versions are like save points',
    body: "'main' is your primary version. Want to try re-recording a part without affecting main? Create a new branch — it starts as an exact copy, and you can always merge your changes back later.",
  },
  {
    target: 'new-branch-button',
    title: 'Branch off to experiment',
    body: 'Click here to create a new version. Replace a track, tweak the structure, add a comment — anything you do in a branch stays separate from main until you decide to merge it.',
  },
  {
    target: 'save-version-button',
    title: 'Bring changes back together',
    body: "When you're happy with a branch, merge it into main. If both versions changed the same thing, you'll get a clear side-by-side comparison to choose from — no surprises.",
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
    body: 'Attach lyrics, DAW project files, reference links — anything related to this song. Access it quickly from the band page too, without opening the full project.',
  },
  {
    target: 'share-button',
    title: 'Share with your band',
    body: 'Anyone in your band can open this link. Export WAV when you need the full mix or individual stems.',
  },
]

const CARD_W = 320
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
    // Default to below even if cramped
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

  // Clamp to viewport
  top = Math.max(8, Math.min(vh - cardEstimatedH - 8, top))
  left = Math.max(8, Math.min(vw - CARD_W - 8, left))

  return { top, left, placement }
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ProjectTourProps {
  projectName: string
  /** Tour is displayed when true */
  show: boolean
  onFinish: () => void
  onSkip: () => void
}

export function ProjectTour({ projectName, show, onFinish, onSkip }: ProjectTourProps) {
  // visibleSteps is the subset of ALL_STEPS that have reachable targets
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([])
  const [stepIndex, setStepIndex] = useState(0)
  const [spotlight, setSpotlight] = useState<SpotlightState | null>(null)
  const [card, setCard] = useState<CardState | null>(null)
  const [mounted, setMounted] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMounted(true), [])

  // On show, reset and build visible step list
  useEffect(() => {
    if (!show) return
    setStepIndex(0)
    setVisibleSteps(ALL_STEPS) // start with all; targets resolved per-step
  }, [show])

  const goToStep = useCallback(async (idx: number, steps: TourStep[]) => {
    if (idx >= steps.length) return
    setTransitioning(true)

    const step = steps[idx]

    if (step.target === null) {
      // Centered full-dim card
      setSpotlight(null)
      setCard({ top: window.innerHeight / 2 - 150, left: window.innerWidth / 2 - CARD_W / 2, placement: 'center' })
      setTransitioning(false)
      return
    }

    const el = await resolveTarget(step.target)
    if (!el) {
      // Skip this step
      const newSteps = steps.filter((_, i) => i !== idx)
      setVisibleSteps(newSteps)
      // Recurse with same index (now pointing to next step in filtered list)
      await goToStep(idx, newSteps)
      return
    }

    // Scroll into view, then wait for scroll
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await new Promise(r => setTimeout(r, 320))

    const rect = el.getBoundingClientRect()
    const sp: SpotlightState = {
      top: rect.top - CARD_PADDING,
      left: rect.left - CARD_PADDING,
      width: rect.width + CARD_PADDING * 2,
      height: rect.height + CARD_PADDING * 2,
    }
    setSpotlight(sp)

    // Estimate card height for placement (we'll refine after render)
    const estH = 200
    const cardPos = computeCardPlacement(sp, estH)
    setCard(cardPos)
    setTransitioning(false)
  }, [])

  // Navigate to current step when stepIndex or visibleSteps changes
  useEffect(() => {
    if (!show || visibleSteps.length === 0) return
    goToStep(stepIndex, visibleSteps)
  }, [show, stepIndex, visibleSteps, goToStep])

  // Recalculate position after card renders (actual height)
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

  // Resize handler
  useEffect(() => {
    if (!show) return
    function handleResize() {
      goToStep(stepIndex, visibleSteps)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [show, stepIndex, visibleSteps, goToStep])

  const handleNext = useCallback(() => {
    if (stepIndex < visibleSteps.length - 1) {
      setStepIndex(i => i + 1)
    } else {
      onFinish()
    }
  }, [stepIndex, visibleSteps.length, onFinish])

  const handleBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex(i => i - 1)
  }, [stepIndex])

  const handleSkip = useCallback(() => {
    onSkip()
  }, [onSkip])

  if (!mounted || !show) return null

  const currentStep = visibleSteps[stepIndex]
  if (!currentStep) return null

  const totalSteps = visibleSteps.length
  const displayStep = stepIndex + 1
  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1
  const showSkip = stepIndex <= 1

  const title = currentStep.title.replace('{PROJECT_NAME}', projectName)
  const isCenter = currentStep.target === null

  return createPortal(
    <>
      {/* Backdrop / spotlight overlay */}
      {isCenter ? (
        // Full dim
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 300,
          pointerEvents: 'none',
        }} />
      ) : spotlight ? (
        // Box-shadow cutout spotlight
        <div
          style={{
            position: 'fixed',
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
            border: '2px solid var(--accent)',
            pointerEvents: 'none',
            zIndex: 301,
            transition: 'top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease',
          }}
        />
      ) : null}

      {/* Invisible click-capture layer to block interaction with page */}
      <div style={{
        position: 'fixed', inset: 0,
        zIndex: 300,
        pointerEvents: transitioning ? 'auto' : 'auto',
        cursor: 'default',
      }} />

      {/* Tour card */}
      {card && (
        <div
          ref={cardRef}
          style={{
            position: 'fixed',
            top: card.top,
            left: card.left,
            width: CARD_W,
            zIndex: 302,
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--accent)',
            borderRadius: 'var(--border-radius-lg, 16px)',
            padding: 16,
            transition: 'top 0.25s ease, left 0.25s ease',
          }}
        >
          {/* Caret */}
          {!isCenter && <Caret placement={card.placement} spotlight={spotlight} cardLeft={card.left} cardTop={card.top} cardW={CARD_W} />}

          {/* Top row: step indicator + close */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Step {displayStep} of {totalSteps}
            </span>
            <button
              onClick={handleSkip}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                color: 'var(--text-dim)', display: 'flex', alignItems: 'center',
                borderRadius: 4, lineHeight: 1,
              }}
              title="Close tour"
            >
              <XIcon />
            </button>
          </div>

          {/* Title */}
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.4 }}>
            {title}
          </p>

          {/* Body */}
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 16px' }}>
            {currentStep.body}
          </p>

          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {visibleSteps.map((_, i) => (
              <div
                key={i}
                style={{
                  borderRadius: '50%',
                  width: i === stepIndex ? 6 : 5,
                  height: i === stepIndex ? 6 : 5,
                  background: i === stepIndex
                    ? 'var(--accent)'
                    : i < stepIndex
                    ? 'var(--text-dim)'
                    : 'var(--border-light)',
                  transition: 'background 0.2s, width 0.2s, height 0.2s',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>

          {/* Footer buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            {showSkip && (
              <button
                onClick={handleSkip}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px',
                  fontSize: 12, color: 'var(--text-dim)', marginRight: 'auto',
                }}
              >
                Skip tour
              </button>
            )}
            {!isFirst && (
              <button
                onClick={handleBack}
                style={{
                  background: 'none',
                  border: '0.5px solid var(--border)',
                  borderRadius: 7, padding: '6px 14px',
                  fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-light)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                background: 'var(--accent)',
                border: 'none', borderRadius: 7,
                padding: '6px 16px',
                fontSize: 13, fontWeight: 500,
                color: 'var(--on-accent)', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)' }}
            >
              {isFirst ? 'Start' : isLast ? 'Finish' : 'Next'}
            </button>
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

  const CARET = 8
  const style: React.CSSProperties = { position: 'absolute', width: 0, height: 0 }

  if (placement === 'below') {
    // Caret on top edge of card, pointing up toward the element
    const anchorX = spotlight.left + spotlight.width / 2
    const caretX = Math.max(CARET, Math.min(cardW - CARET * 2, anchorX - cardLeft))
    return (
      <div style={{
        ...style,
        top: -CARET,
        left: caretX,
        borderLeft: `${CARET}px solid transparent`,
        borderRight: `${CARET}px solid transparent`,
        borderBottom: `${CARET}px solid var(--accent)`,
      }} />
    )
  }

  if (placement === 'above') {
    // Caret on bottom edge of card, pointing down toward the element
    const anchorX = spotlight.left + spotlight.width / 2
    const caretX = Math.max(CARET, Math.min(cardW - CARET * 2, anchorX - cardLeft))
    return (
      <div style={{
        ...style,
        bottom: -CARET,
        left: caretX,
        borderLeft: `${CARET}px solid transparent`,
        borderRight: `${CARET}px solid transparent`,
        borderTop: `${CARET}px solid var(--accent)`,
      }} />
    )
  }

  if (placement === 'right') {
    // Caret on left edge of card, pointing left toward the element
    const anchorY = spotlight.top + spotlight.height / 2
    // We don't know card height here, just use a midpoint approximation
    return (
      <div style={{
        ...style,
        left: -CARET,
        top: Math.max(CARET, anchorY - cardTop - CARET),
        borderTop: `${CARET}px solid transparent`,
        borderBottom: `${CARET}px solid transparent`,
        borderRight: `${CARET}px solid var(--accent)`,
      }} />
    )
  }

  if (placement === 'left') {
    // Caret on right edge of card, pointing right toward the element
    const anchorY = spotlight.top + spotlight.height / 2
    return (
      <div style={{
        ...style,
        right: -CARET,
        top: Math.max(CARET, anchorY - cardTop - CARET),
        borderTop: `${CARET}px solid transparent`,
        borderBottom: `${CARET}px solid transparent`,
        borderLeft: `${CARET}px solid var(--accent)`,
      }} />
    )
  }

  return null
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

// ─── Help button (exported separately for use in topbar) ─────────────────────

export function TourHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Show tour"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32,
        background: 'transparent', border: '0.5px solid var(--border)',
        borderRadius: 8, cursor: 'pointer',
        color: 'var(--text-dim)',
        transition: 'border-color 0.12s, color 0.12s',
      }}
      onMouseEnter={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.borderColor = 'var(--border-light)'
        b.style.color = 'var(--text-muted)'
      }}
      onMouseLeave={e => {
        const b = e.currentTarget as HTMLButtonElement
        b.style.borderColor = 'var(--border)'
        b.style.color = 'var(--text-dim)'
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="7" />
        <path d="M6 6a2 2 0 1 1 2.5 1.9C7.9 8.2 8 8.7 8 9" />
        <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </button>
  )
}

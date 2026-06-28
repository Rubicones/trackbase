'use client'

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ChordDurationPicker } from '@/components/ChordDurationPicker'
import {
  buildChordTimeline,
  findActiveChordGlobalIndex,
  formatBarDuration,
} from '@/lib/chords'
import type { Section } from '@/lib/types'

const ITEM_GAP = 4
const UPCOMING_LOOKAHEAD = 2

function PlaybackChip({
  name,
  duration,
  active,
  past,
  compact,
  onClick,
}: {
  name: string
  duration: number
  active: boolean
  past?: boolean
  compact?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const showDuration = Math.abs(duration - 1) >= 0.001
  const minSize = compact ? 'min-w-8 min-h-8' : 'min-w-9 min-h-9'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`inline-flex shrink-0 border flex-col items-center justify-center transition-all duration-200 px-1.5 ${minSize} ${
        active
          ? 'border-lime bg-lime text-primary-foreground opacity-100'
          : past
            ? 'border-border/50 text-muted-foreground/50 bg-surface/50 opacity-40'
            : onClick
              ? 'border-border/80 text-foreground/75 bg-surface hover:border-foreground/40 cursor-pointer opacity-100'
              : 'border-border/80 text-foreground/75 bg-surface opacity-100'
      }`}
      title={showDuration ? `${name} · ${formatBarDuration(duration)} bars` : name}
    >
      <span className={`font-bold leading-none whitespace-nowrap ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
        {name}
      </span>
      {showDuration && (
        <span className={`text-[7px] font-mono leading-none mt-0.5 ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          {formatBarDuration(duration)}
        </span>
      )}
    </button>
  )
}

function SectionBreak({
  label,
  compact,
  past,
  showDivider = true,
}: {
  label: string
  compact?: boolean
  past?: boolean
  /** Omit leading rule at the start of the chord row. */
  showDivider?: boolean
}) {
  return (
    <div className={`flex items-center shrink-0 gap-1 transition-opacity duration-200 ${past ? 'opacity-40' : 'opacity-100'}`}>
      {showDivider && (
        <div className={`w-px bg-border shrink-0 ${compact ? 'h-5' : 'h-6'}`} aria-hidden />
      )}
      <span className={`uppercase tracking-widest text-muted-foreground shrink-0 ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
        {label}
      </span>
    </div>
  )
}

function rowStepWidth(row: HTMLElement | undefined): number {
  if (!row) return 0
  return row.offsetWidth + ITEM_GAP
}

function scrollBeforeIndex(rowRefs: Map<number, HTMLDivElement>, index: number): number {
  if (index <= 0) return 0
  let total = 0
  for (let i = 0; i < index; i++) {
    total += rowStepWidth(rowRefs.get(i))
  }
  return total
}

/** Desktop: scroll only as far right as needed to show the next two upcoming chords. */
function scrollToRevealUpcoming(
  container: HTMLElement,
  rowRefs: Map<number, HTMLDivElement>,
  activeIndex: number,
  maxIndex: number,
  smooth: boolean,
): void {
  const upcomingEnd = Math.min(activeIndex + UPCOMING_LOOKAHEAD, maxIndex)
  const upcomingEl = rowRefs.get(upcomingEnd)
  const activeEl = rowRefs.get(activeIndex)
  if (!upcomingEl) return

  const cr = container.getBoundingClientRect()
  const ur = upcomingEl.getBoundingClientRect()
  let scrollDelta = 0

  if (ur.right > cr.right - ITEM_GAP) {
    scrollDelta = ur.right - cr.right + ITEM_GAP
  }

  if (activeEl) {
    const ar = activeEl.getBoundingClientRect()
    if (ar.left < cr.left + ITEM_GAP) {
      scrollDelta = ar.left - cr.left - ITEM_GAP
    }
  }

  if (Math.abs(scrollDelta) < 1) return

  container.scrollTo({
    left: Math.max(0, container.scrollLeft + scrollDelta),
    behavior: smooth ? 'smooth' : 'auto',
  })
}

export function ChordPlaybackRow({
  sections,
  currentTimeMs,
  barDurationMs,
  compact = false,
  className = '',
  onChordDurationChange,
  currentTimeRef,
  playing = false,
  seekEpoch = 0,
}: {
  sections: Section[]
  currentTimeMs: number
  barDurationMs: number
  /** Mobile — scroll past chords out. Desktop — dim past, only scroll for upcoming. */
  compact?: boolean
  className?: string
  onChordDurationChange?: (sectionId: string, sectionChordIndex: number, duration: number) => void
  currentTimeRef?: RefObject<number>
  playing?: boolean
  /** Bumps on every seek — forces chord-row scroll to resync after section jumps. */
  seekEpoch?: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const prevActiveRef = useRef<number | null>(null)
  const prevSeekEpochRef = useRef(seekEpoch ?? 0)
  const prevPlayingRef = useRef(playing)
  const [playheadTick, setPlayheadTick] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [scrollAnimated, setScrollAnimated] = useState(false)
  const userScrollingRef = useRef(false)
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programmaticScrollRef = useRef(false)
  const [durationPicker, setDurationPicker] = useState<{
    sectionId: string
    sectionChordIndex: number
    duration: number
    rect: DOMRect
  } | null>(null)

  const timeline = useMemo(() => buildChordTimeline(sections), [sections])
  const mobileScrollOut = compact

  useEffect(() => {
    prevActiveRef.current = null
    setScrollOffset(0)
    setScrollAnimated(false)
  }, [timeline])

  useEffect(() => {
    if (!playing || !currentTimeRef) return
    let raf = 0
    const loop = () => {
      setPlayheadTick(t => t + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, currentTimeRef])

  useEffect(() => {
    setPlayheadTick(t => t + 1)
  }, [currentTimeMs])

  const effectiveTimeMs = currentTimeRef
    ? (currentTimeRef.current ?? 0) * 1000
    : currentTimeMs
  void playheadTick

  const activeGlobalIndex = findActiveChordGlobalIndex(
    sections,
    effectiveTimeMs,
    barDurationMs,
  )

  function applyMobileScroll(target: number, smooth: boolean) {
    const container = viewportRef.current
    if (!container) return

    setScrollAnimated(smooth)
    setScrollOffset(target)

    if (playing) {
      if (container.scrollLeft !== 0) container.scrollLeft = 0
      return
    }

    programmaticScrollRef.current = true
    container.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' })
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }

  useLayoutEffect(() => {
    if (!mobileScrollOut) return
    if (seekEpoch === prevSeekEpochRef.current) return

    prevSeekEpochRef.current = seekEpoch
    userScrollingRef.current = false
    prevActiveRef.current = null
  }, [seekEpoch, mobileScrollOut])

  useLayoutEffect(() => {
    if (!mobileScrollOut) return

    const container = viewportRef.current
    if (!container) return

    const wasPlaying = prevPlayingRef.current
    prevPlayingRef.current = playing

    if (wasPlaying === playing) return

    if (playing) {
      container.scrollLeft = 0
      return
    }

    programmaticScrollRef.current = true
    container.scrollLeft = scrollOffset
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }, [playing, mobileScrollOut, scrollOffset])

  useLayoutEffect(() => {
    if (activeGlobalIndex === null) return
    if (!playing && userScrollingRef.current) return

    const prev = prevActiveRef.current
    if (prev === activeGlobalIndex) return

    const container = viewportRef.current
    if (!container) return

    const smooth = prev !== null
    prevActiveRef.current = activeGlobalIndex

    if (mobileScrollOut) {
      const target = scrollBeforeIndex(rowRefs.current, activeGlobalIndex)
      applyMobileScroll(target, smooth)
      return
    }

    requestAnimationFrame(() => {
      scrollToRevealUpcoming(
        container,
        rowRefs.current,
        activeGlobalIndex,
        timeline.length - 1,
        smooth,
      )
    })
  }, [activeGlobalIndex, playing, timeline, mobileScrollOut])

  function markUserScroll() {
    if (programmaticScrollRef.current) return
    if (playing && mobileScrollOut) return
    userScrollingRef.current = true
    if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current)
    userScrollTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false
    }, 2500)
  }

  function handleChipClick(item: typeof timeline[number], e: React.MouseEvent<HTMLButtonElement>) {
    if (!onChordDurationChange) return
    e.stopPropagation()
    setDurationPicker({
      sectionId: item.sectionId,
      sectionChordIndex: item.sectionChordIndex,
      duration: item.duration,
      rect: e.currentTarget.getBoundingClientRect(),
    })
  }

  function handleDurationSelect(duration: number) {
    if (!durationPicker || !onChordDurationChange) return
    onChordDurationChange(
      durationPicker.sectionId,
      durationPicker.sectionChordIndex,
      duration,
    )
    setDurationPicker(null)
  }

  if (timeline.length === 0) return null

  const rowMinH = compact ? 36 : 40
  const useTransformScroll = mobileScrollOut && playing

  return (
    <>
      <div
        ref={viewportRef}
        className={`${useTransformScroll ? 'overflow-hidden' : 'overflow-x-auto'} overflow-y-hidden scrollbar-none touch-pan-x ${className}`}
        style={{ minHeight: rowMinH, WebkitOverflowScrolling: 'touch' }}
        onWheel={markUserScroll}
        onTouchStart={markUserScroll}
        onScroll={markUserScroll}
      >
        <div
          className="inline-flex items-center h-full py-1 pl-1 pr-2 gap-1 min-h-[inherit]"
          style={
            useTransformScroll
              ? {
                  transform: `translateX(${-scrollOffset}px)`,
                  transition: scrollAnimated ? 'transform 0.25s ease-out' : undefined,
                  willChange: 'transform',
                }
              : undefined
          }
        >
          {timeline.map((item, idx) => {
            const showSectionBreak = item.isSectionStart
            const isActive = item.globalIndex === activeGlobalIndex
            const isPast = activeGlobalIndex !== null && item.globalIndex < activeGlobalIndex

            return (
              <div
                key={`${item.sectionId}-${item.sectionChordIndex}`}
                ref={el => {
                  if (el) rowRefs.current.set(item.globalIndex, el)
                  else rowRefs.current.delete(item.globalIndex)
                }}
                className="inline-flex items-center shrink-0 gap-1"
              >
                {showSectionBreak && (
                  <SectionBreak
                    label={item.sectionLabel}
                    compact={compact}
                    past={isPast}
                    showDivider={idx > 0}
                  />
                )}
                <PlaybackChip
                  name={item.name}
                  duration={item.duration}
                  active={isActive}
                  past={isPast}
                  compact={compact}
                  onClick={onChordDurationChange ? e => handleChipClick(item, e) : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>

      {durationPicker && onChordDurationChange && (
        <ChordDurationPicker
          anchorRect={durationPicker.rect}
          currentDuration={durationPicker.duration}
          onSelect={handleDurationSelect}
          onClose={() => setDurationPicker(null)}
        />
      )}
    </>
  )
}

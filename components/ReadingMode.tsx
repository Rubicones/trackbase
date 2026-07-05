'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import Link from 'next/link'
import { Maximize2, Minimize2, ChevronDown } from 'lucide'
import { ChordPlaybackRow } from '@/components/ChordPlaybackRow'
import { sectionLabel } from '@/components/StructureEditor'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbMenuButton } from '@/components/design/TbButton'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { Spinner } from '@/components/ui/Spinner'
import type { Section, Version, Project, ProjectResource } from '@/lib/types'
import { buildChordTimeline, findActiveChordGlobalIndex } from '@/lib/chords'
import { buildSectionRanges, findSectionRangeAtTime } from '@/lib/sectionPlayback'
import { sortMobileVersions } from '@/lib/versionSort'
import { VersionListName } from '@/components/VersionListName'
import { SonicdeskWordmark } from '@/components/design/SonicdeskWordmark'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadingModePlayer = {
  playing: boolean
  currentTime: number
  duration: number
  loaded: number
  total: number
  /** True when preview mix or all FLAC tracks are ready to play. */
  playbackReady: boolean
  /** Cached preview MP3 vs per-track FLAC mix currently driving playback. */
  playbackMix: 'preview' | 'full' | 'none'
  play: () => void
  pause: () => void
  seek: (t: number) => void
  /** Bumps on every seek — resyncs chord row scroll after section jumps. */
  seekEpoch?: number
  /** Ref updated every rAF frame — used for smooth chord highlighting during playback. */
  currentTimeRef?: RefObject<number>
}

type ChordView = 'big' | 'list'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

/**
 * Font size for the giant "Chord now" readout, shrinking as chord names get longer
 * (e.g. C#sus4/B5m). Uses clamp(min, vw, max) — a fixed pixel floor/ceiling with vw
 * scaling in between — rather than a Tailwind `text-[Nvw] sm:text-[Mpx]` pair, so it
 * scales smoothly with viewport width instead of jumping at the sm: breakpoint, and
 * (critically) never goes so small on a narrow phone that it dips below the "Next"
 * chord's size — see NEXT_CHORD_RATIO below, which derives Next directly from this.
 */
function bigChordFontSize(name: string | undefined): string {
  const len = name?.length ?? 1
  if (len <= 2) return 'clamp(56px, 20vw, 104px)'
  if (len <= 4) return 'clamp(40px, 14vw, 72px)'
  if (len <= 7) return 'clamp(28px, 10vw, 52px)'
  return 'clamp(20px, 7vw, 36px)'
}

/** "Now" must always read as ~1.5x larger than "Next" — Next is derived from Now's
 * actual size via calc(), not chosen independently from its own name length, so the
 * ratio holds regardless of viewport width or how long either chord's name is. */
const NEXT_CHORD_RATIO = 1.5
function nextChordFontSize(nowName: string | undefined): string {
  return `calc(${bigChordFontSize(nowName)} / ${NEXT_CHORD_RATIO})`
}

// ─── Chord carousel geometry ──────────────────────────────────────────────────
// A 4-slot filmstrip: exiting-now (-1) · now (0) · next (1) · entering-next (2).
// Every slot is always mounted (the -1 and 2 slots just sit clipped outside the
// viewport at rest) so that when the active chord advances, React matches each
// chord by its stable identity (globalIndex) across the offset change, and plain
// CSS transitions on left/width/font-size/color animate all three visible motions
// — now exits left, next slides into now's spot while morphing, the pre-staged
// buffer slides into next's spot — in perfect lockstep, no JS-driven timing needed.
const CHORD_SLOT_NOW = { left: '0%', width: '56%' }
const CHORD_SLOT_NEXT = { left: '62%', width: '38%' }
const CHORD_SLOT_EXIT = { left: '-60%', width: '56%' }
const CHORD_SLOT_ENTER = { left: '100%', width: '38%' }

function chordSlotBox(offset: number): { left: string; width: string } {
  if (offset <= -1) return CHORD_SLOT_EXIT
  if (offset === 0) return CHORD_SLOT_NOW
  if (offset === 1) return CHORD_SLOT_NEXT
  return CHORD_SLOT_ENTER
}

// Render window: exiting-now, now, next, pre-staged buffer.
const CHORD_CAROUSEL_OFFSETS = [-1, 0, 1, 2] as const

// ─── Compact version dropdown ─────────────────────────────────────────────────

function VersionDropdown({
  versions, activeVersionId, onSelect, versionSwitchDisabled = false,
}: {
  versions: Version[]
  activeVersionId: string
  onSelect: (id: string) => void
  versionSwitchDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const sorted = useMemo(() => sortMobileVersions(versions), [versions])
  const active = versions.find(v => v.id === activeVersionId) ?? versions[0]

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!active) return null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Versions"
        aria-expanded={open}
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-2 bg-lime text-primary-foreground text-[10px] font-bold uppercase tracking-widest max-w-[132px]"
      >
        <span className="size-1.5 rounded-full bg-primary-foreground shrink-0" />
        <VersionListName version={active} className="truncate" />
        <LucideIcon icon={ChevronDown} size={12} className="shrink-0 opacity-80" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[520] w-56 max-h-72 overflow-y-auto border border-border bg-popover shadow-2xl">
          {sorted.map(v => {
            const isActive = v.id === activeVersionId
            const blocked = versionSwitchDisabled && !isActive
            return (
              <TbMenuButton
                key={v.id}
                active={isActive}
                disabled={blocked}
                onClick={() => { onSelect(v.id); setOpen(false) }}
                className="gap-2.5"
              >
                <span
                  className={`size-1.5 rounded-full shrink-0 ${
                    isActive ? 'bg-lime' : v.merged_at ? 'bg-online' : 'bg-muted-foreground'
                  }`}
                />
                <VersionListName version={v} className="flex-1 truncate" />
                {v.type === 'main' && (
                  <span className="text-[9px] uppercase tracking-widest text-lime border border-lime/40 px-1.5 shrink-0">
                    Master
                  </span>
                )}
              </TbMenuButton>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Chord Big / List toggle ──────────────────────────────────────────────────

function ChordViewToggle({ view, onChange }: { view: ChordView; onChange: (v: ChordView) => void }) {
  return (
    <div className="flex border border-border shrink-0">
      <button
        type="button"
        onClick={() => onChange('big')}
        aria-pressed={view === 'big'}
        className={`px-2.5 h-7 text-[9px] font-bold uppercase tracking-widest transition ${
          view === 'big' ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        ◆ Now
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        aria-pressed={view === 'list'}
        className={`px-2.5 h-7 text-[9px] font-bold uppercase tracking-widest border-l border-border transition ${
          view === 'list' ? 'bg-lime text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        ≡ List
      </button>
    </div>
  )
}

// ─── Transport toggle (matches mixer bottom bar) ─────────────────────────────

function RehearsalTransportToggle({
  label, active, onClick, tooltip, disabled = false,
}: {
  label: string
  active: boolean
  onClick: () => void
  tooltip: string
  disabled?: boolean
}) {
  return (
    <HoverTooltip label={tooltip} className="w-full">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        className={`w-full h-7 px-1 text-[9px] font-bold uppercase tracking-widest border transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active
            ? 'border-lime bg-lime text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
        }`}
      >
        {label}
      </button>
    </HoverTooltip>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReadingMode({
  project,
  player,
  sections,
  versions,
  activeVersionId,
  onVersionChange,
  versionSwitchDisabled = false,
  projectId,
  bandId,
  barDurationMs,
  visible,
  embedded = false,
  fullscreen = false,
  onToggleFullscreen,
  sectionLoopOn,
  sectionLoopEnabled,
  onToggleSectionLoop,
  metronomeOn,
  countdownOn,
  isCounting,
  onToggleMetronome,
  onToggleCountdown,
}: {
  project: Project
  player: ReadingModePlayer
  sections: Section[]
  versions: Version[]
  activeVersionId: string
  onVersionChange: (id: string) => void
  versionSwitchDisabled?: boolean
  projectId: string
  bandId: string
  barDurationMs: number
  visible: boolean
  /** When true, renders inside MobileExperience (no outer shell or header). */
  embedded?: boolean
  /** Fullscreen rehearsal — hides chrome, keeps chords/lyrics/transport only. */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  sectionLoopOn: boolean
  sectionLoopEnabled: boolean
  onToggleSectionLoop: () => void
  metronomeOn: boolean
  countdownOn: boolean
  isCounting: boolean
  onToggleMetronome: () => void
  onToggleCountdown: () => void
}) {
  const [chordView, setChordView] = useState<ChordView>('big')
  const [lyrics, setLyrics] = useState<ProjectResource | null>(null)
  const [autoscrollOn, setAutoscrollOn] = useState(true)
  const [lyricsSpeed, setLyricsSpeed] = useState(1)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/resources`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.resources) return
        setLyrics(data.resources.find((r: ProjectResource) => r.type === 'lyrics') ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, visible])

  // ─── Chord / section timeline derived from playhead ──────────────────────
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.start_bar - b.start_bar),
    [sections],
  )
  const timeline = useMemo(() => buildChordTimeline(sections), [sections])
  const sectionRanges = useMemo(() => buildSectionRanges(sections), [sections])

  // Absolute start bar for each timeline chord — used to find the most recently
  // played chord even when the playhead sits in a gap between/after sections.
  const timelineStartBars = useMemo(() => {
    const sectionStartBar = new Map(sortedSections.map(s => [s.id, s.start_bar]))
    const offsetWithinSection = new Map<string, number>()
    return timeline.map(t => {
      const base = sectionStartBar.get(t.sectionId) ?? 0
      const offset = offsetWithinSection.get(t.sectionId) ?? 0
      offsetWithinSection.set(t.sectionId, offset + t.duration)
      return base + offset
    })
  }, [timeline, sortedSections])

  const activeGlobalIndex = findActiveChordGlobalIndex(sections, player.currentTime * 1000, barDurationMs)
  const currentBarFloat = barDurationMs > 0 ? (player.currentTime * 1000) / barDurationMs : 0

  // Last chord chronologically at or before the playhead, even outside any section range.
  let lastKnownIndex = -1
  for (let i = 0; i < timelineStartBars.length; i++) {
    if (timelineStartBars[i] <= currentBarFloat + 0.0001) lastKnownIndex = i
    else break
  }

  const displayChordIndex = activeGlobalIndex !== null ? activeGlobalIndex : lastKnownIndex

  // The "Chord now" / "Next" readout is a 4-slot carousel (see chordSlotBox below):
  // every slot is keyed by the chord's own timeline index, so when displayChordIndex
  // advances, React keeps the same DOM node for each chord and only its position/
  // size/color style changes — a plain CSS transition then animates all three
  // motions (now exits left, next morphs into now, a new next enters from the
  // right) in perfect lockstep, with no JS-driven orchestration needed.
  const currentChord = displayChordIndex >= 0 ? timeline[displayChordIndex] ?? null : null
  const nextChord = displayChordIndex >= 0 ? timeline[displayChordIndex + 1] ?? null : timeline[0] ?? null

  const barDurationSec = barDurationMs / 1000
  const currentRange = barDurationSec > 0
    ? findSectionRangeAtTime(sectionRanges, player.currentTime, barDurationSec)
    : null
  const currentSection = currentRange ? sortedSections.find(s => s.id === currentRange.id) ?? null : null
  const currentSectionIdx = currentSection ? sortedSections.findIndex(s => s.id === currentSection.id) : -1
  const nextSection = currentSectionIdx >= 0 ? sortedSections[currentSectionIdx + 1] ?? null : null

  const sectionBarSpan = currentSection ? Math.max(1, currentSection.end_bar - currentSection.start_bar) : 0
  const barsElapsedInSection = currentSection ? Math.max(0, currentBarFloat - currentSection.start_bar) : 0
  const sectionProgressPct = sectionBarSpan > 0
    ? Math.min(100, Math.max(0, (barsElapsedInSection / sectionBarSpan) * 100))
    : 0
  const barInSectionDisplay = currentSection ? Math.min(sectionBarSpan, Math.floor(barsElapsedInSection) + 1) : 0

  function sectionStartTime(startBar: number): string {
    return fmt((startBar * barDurationMs) / 1000)
  }

  // ─── Lyrics teleprompter autoscroll ───────────────────────────────────────
  const lyricsLines = useMemo(() => (lyrics?.content?.trim() ? lyrics.content.split('\n') : []), [lyrics])
  const lyricsRef = useRef<HTMLDivElement>(null)
  const lyricsUserScrollRef = useRef(false)
  const lyricsUserScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lyricsProgrammaticScrollRef = useRef(false)
  const lyricsWasActiveRef = useRef(false)
  const autoscrollWasOnRef = useRef(autoscrollOn)
  const lyricsPlaying = player.playing || isCounting
  const scrollableRehearsal = embedded
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const lyricsSectionRef = useRef<HTMLElement>(null)

  function scrollBodyToLyrics() {
    const body = bodyScrollRef.current
    const section = lyricsSectionRef.current
    if (!body || !section) return
    const bodyRect = body.getBoundingClientRect()
    const sectionRect = section.getBoundingClientRect()
    body.scrollTop += sectionRect.top - bodyRect.top
  }

  // Reset teleprompter on playback restart; on mobile, also snap page to lyrics.
  useEffect(() => {
    const wasPlaying = lyricsWasActiveRef.current
    lyricsWasActiveRef.current = lyricsPlaying

    const el = lyricsRef.current
    if (el && !wasPlaying && lyricsPlaying && player.currentTime < 1) {
      el.scrollTop = 0
      if (scrollableRehearsal && bodyScrollRef.current) {
        bodyScrollRef.current.scrollTop = 0
      }
    }

    if (scrollableRehearsal && autoscrollOn && !wasPlaying && lyricsPlaying) {
      requestAnimationFrame(scrollBodyToLyrics)
    }
  }, [lyricsPlaying, player.currentTime, scrollableRehearsal, autoscrollOn])

  useEffect(() => {
    const wasOn = autoscrollWasOnRef.current
    autoscrollWasOnRef.current = autoscrollOn
    if (scrollableRehearsal && !wasOn && autoscrollOn && lyricsPlaying) {
      requestAnimationFrame(scrollBodyToLyrics)
    }
  }, [autoscrollOn, scrollableRehearsal, lyricsPlaying])

  // Teleprompter-style scroll — enabled by the Autoscroll toggle, but only actually
  // moves while the track is playing (paused whenever playback is paused/stopped).
  // Rate controlled by the speed stepper.
  //
  // Note: we track our own float accumulator instead of doing `el.scrollTop += delta`.
  // scrollTop is reported back as an integer by the browser, so repeatedly reading
  // the (already-rounded) value and adding a sub-pixel delta to it loses the
  // fractional remainder every frame and can get stuck at 0 forever.
  useEffect(() => {
    if (!autoscrollOn || !lyricsPlaying || lyricsSpeed <= 0) return
    const maybeEl = lyricsRef.current
    if (!maybeEl) return
    const el: HTMLDivElement = maybeEl

    let raf = 0
    let lastTs: number | null = null
    let acc = el.scrollTop
    const BASE_PX_PER_SEC = 18

    function tick(ts: number) {
      if (lyricsUserScrollRef.current) {
        // User took over — resync our accumulator so we resume from where they left it.
        acc = el.scrollTop
        lastTs = ts
        raf = requestAnimationFrame(tick)
        return
      }
      if (lastTs !== null) {
        const dt = ts - lastTs
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        acc = Math.min(max, acc + (BASE_PX_PER_SEC * lyricsSpeed * dt) / 1000)
        // Setting scrollTop fires a native 'scroll' event — flag it as programmatic
        // so our own scroll listener doesn't mistake it for user input and pause us.
        lyricsProgrammaticScrollRef.current = true
        el.scrollTop = acc
      }
      lastTs = ts
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [autoscrollOn, lyricsPlaying, lyricsSpeed])

  // Real user input (touch/wheel) — always counts as taking over the scroll.
  function markLyricsUserScroll() {
    lyricsUserScrollRef.current = true
    if (lyricsUserScrollTimerRef.current) clearTimeout(lyricsUserScrollTimerRef.current)
    lyricsUserScrollTimerRef.current = setTimeout(() => {
      lyricsUserScrollRef.current = false
    }, 3000)
  }

  // The 'scroll' event fires for both user input and our own programmatic
  // writes — ignore the ones we caused ourselves so autoscroll doesn't
  // immediately re-flag itself as "user scrolling" every single frame.
  function handleLyricsScrollEvent() {
    if (lyricsProgrammaticScrollRef.current) {
      lyricsProgrammaticScrollRef.current = false
      return
    }
    markLyricsUserScroll()
  }

  if (!visible) return null

  const progressPct = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0

  function handleSeek(ratio: number) {
    player.seek(ratio * player.duration)
  }

  const isLoadingTracks = player.total > 0 && player.loaded < player.total
  const awaitingPlayback = player.total > 0 && !player.playbackReady

  const shellClass = embedded
    ? 'flex flex-col flex-1 min-h-0 relative overflow-hidden'
    : 'fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden'

  const showChrome = !fullscreen
  const transportBottom = embedded || fullscreen ? 'bottom-0' : 'bottom-[52px]'
  const bodyPadBottom = embedded || fullscreen ? 'pb-28' : 'pb-[7.5rem]'

  return (
    <div className={shellClass}>
      {!embedded && showChrome && (
        <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <SonicdeskWordmark href="/dashboard" className="text-sm" />
            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-w-0 overflow-hidden"
            >
              <Link href="/dashboard" className="hover:text-foreground no-underline shrink-0">
                Bands
              </Link>
              <span className="text-border shrink-0">/</span>
              <Link
                href={`/band/${bandId}`}
                className="tb-type-name text-xs hover:text-foreground no-underline truncate min-w-0"
              >
                {project.band_name ?? 'Band'}
              </Link>
              <span className="text-border shrink-0">/</span>
              <span className="tb-type-name text-xs text-foreground truncate min-w-0">{project.name}</span>
            </nav>
          </div>
          <AvatarDropdown />
        </header>
      )}

      {/* Body — on mobile embedded, the whole column scrolls (meta can scroll away).
          Lyrics still autoscroll inside their panel. Desktop keeps flex-fill layout. */}
      <div
        ref={scrollableRehearsal ? bodyScrollRef : undefined}
        className={
          scrollableRehearsal
            ? `flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-none ${bodyPadBottom}`
            : `flex-1 min-h-0 flex flex-col ${bodyPadBottom}`
        }
      >

        {/* Project header — hidden in fullscreen */}
        {showChrome && (
          <div className="shrink-0 px-4 py-3 border-b border-border flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-lime">
                <span className="size-1.5 rounded-full bg-lime animate-pulse-dot" />
                Rehearsal mode
              </div>
              <h1 className="tb-type-name text-2xl sm:text-3xl uppercase tracking-tighter mt-0.5 text-foreground truncate">
                {project.name}
              </h1>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                {project.bpm != null && <span>{project.bpm} BPM</span>}
                {project.key && <span className="text-lime">{project.key}</span>}
                <span>{project.time_signature ?? '4/4'}</span>
                {player.duration > 0 && <span>{fmt(player.duration)}</span>}
              </div>
              {isLoadingTracks && (
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1.5">
                  Loading audio… {player.loaded}/{player.total}
                </p>
              )}
            </div>
            {onToggleFullscreen && (
              <HoverTooltip label="Fullscreen rehearsal" className="shrink-0">
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  aria-label="Fullscreen rehearsal"
                  className="size-9 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-lime hover:text-lime transition"
                >
                  <LucideIcon icon={Maximize2} size={15} />
                </button>
              </HoverTooltip>
            )}
          </div>
        )}

        {/* Version dropdown + chord strip — hidden in fullscreen */}
        {showChrome && (
          <div className="shrink-0 px-4 py-1.5 border-b border-border flex items-center gap-2">
            {versions.length > 0 && (
              <VersionDropdown
                versions={versions}
                activeVersionId={activeVersionId}
                onSelect={onVersionChange}
                versionSwitchDisabled={versionSwitchDisabled}
              />
            )}
            <ChordPlaybackRow
              sections={sections}
              currentTimeMs={player.currentTime * 1000}
              barDurationMs={barDurationMs}
              compact
              className="flex-1 min-w-0"
              currentTimeRef={player.currentTimeRef}
              playing={player.playing || isCounting}
              seekEpoch={player.seekEpoch}
            />
          </div>
        )}

        {/* Now playing — chords, big or list — always visible */}
        <section className="shrink-0 border-b border-border" data-tour="mobile-rehearse-sections">
          <div className="px-4 py-2 flex items-center justify-between border-b border-border bg-surface/20">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Now playing</span>
            <ChordViewToggle view={chordView} onChange={setChordView} />
          </div>

          {sections.length === 0 || timeline.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-6 text-center">No structure added yet</p>
          ) : chordView === 'big' ? (
            <div className={`px-4 py-5 flex flex-col gap-4 ${scrollableRehearsal ? 'min-h-[10rem]' : 'min-h-[16rem] sm:min-h-[18rem]'}`}>
              <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="tb-section-name px-2 py-1 bg-lime text-primary-foreground font-bold truncate">
                    {currentSection ? sectionLabel(currentSection) : '—'}
                  </span>
                  <span className="text-muted-foreground shrink-0">now</span>
                </div>
                {nextSection && (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-muted-foreground shrink-0">next</span>
                    <span className="tb-section-name px-2 py-1 border border-border text-foreground truncate">
                      {sectionLabel(nextSection)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-muted-foreground">
                <span>Chord now</span>
                {nextChord && <span>Next</span>}
              </div>
              <div className="relative h-28 sm:h-32 min-w-0 overflow-hidden">
                {CHORD_CAROUSEL_OFFSETS.map(offset => {
                  const idx = displayChordIndex + offset
                  const chord = idx >= 0 && idx < timeline.length ? timeline[idx] : null
                  if (!chord && offset !== 0) return null
                  const isBig = offset <= 0
                  const box = chordSlotBox(offset)
                  return (
                    <div
                      key={chord ? chord.globalIndex : 'now-placeholder'}
                      style={{
                        left: box.left,
                        width: box.width,
                        fontSize: isBig ? bigChordFontSize(chord?.name) : nextChordFontSize(currentChord?.name),
                        lineHeight: 1,
                      }}
                      className={`absolute top-0 h-full flex items-center overflow-hidden transition-all duration-[260ms] ease-out tb-type-name tracking-tighter break-words ${
                        isBig ? 'text-lime justify-start' : 'text-foreground/70 justify-end'
                      }`}
                    >
                      {chord?.name ?? (offset === 0 ? '—' : '')}
                    </div>
                  )
                })}
                {nextChord && (
                  <div
                    aria-hidden
                    className="absolute top-0 h-full flex items-center pointer-events-none"
                    style={{ left: '58%' }}
                  >
                    <span className="text-border text-3xl">›</span>
                  </div>
                )}
              </div>

              {/* Always reserve this row's height so the layout doesn't jump when a section becomes current. */}
              <div>
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 tabular-nums whitespace-nowrap">
                  {currentSection ? `Bar ${barInSectionDisplay} / ${sectionBarSpan}` : 'Bar — / —'}
                </div>
                <div className="h-1 bg-surface-2">
                  <div
                    className="h-full bg-lime transition-[width] duration-150"
                    style={{ width: `${currentSection ? sectionProgressPct : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[38vh] overflow-y-auto scrollbar-none">
              {sortedSections.map(section => {
                const isCurrent = section.id === currentSection?.id
                const chords = timeline.filter(t => t.sectionId === section.id)
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => player.seek((section.start_bar * barDurationMs) / 1000 + 0.001)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition ${
                      isCurrent ? 'bg-lime/[0.06]' : 'hover:bg-surface/40'
                    }`}
                  >
                    <span
                      className={`tb-section-name text-[9px] font-bold uppercase tracking-widest w-16 shrink-0 pt-0.5 ${
                        isCurrent ? 'text-lime' : 'text-muted-foreground'
                      }`}
                    >
                      {sectionLabel(section)}
                    </span>
                    <div className="flex-1 min-w-0 flex flex-wrap gap-1">
                      {chords.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : chords.map(c => (
                        <span
                          key={c.sectionChordIndex}
                          className={`text-[10px] px-1.5 py-0.5 border ${
                            c.globalIndex === displayChordIndex
                              ? 'bg-lime text-primary-foreground border-lime'
                              : 'border-border text-foreground'
                          }`}
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0 pt-0.5">
                      {sectionStartTime(section.start_bar)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Lyrics — autoscroll teleprompter. On mobile embedded, the section is tall
            enough that scrolling the page reveals a larger lyrics viewport. */}
        <section
          ref={lyricsSectionRef}
          className={
            scrollableRehearsal
              ? 'flex flex-col border-t border-border'
              : 'flex-1 min-h-0 flex flex-col'
          }
        >
          <div className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface/20">
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Lyrics</span>
              <button
                type="button"
                onClick={() => setAutoscrollOn(o => !o)}
                aria-pressed={autoscrollOn}
                className={`px-2 h-6 text-[9px] font-bold uppercase tracking-widest border transition ${
                  autoscrollOn
                    ? 'border-lime bg-lime text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                }`}
              >
                Autoscroll
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLyricsSpeed(s => Math.max(0, +(s - 0.25).toFixed(2)))}
                className="size-7 grid place-items-center text-[11px] border border-border text-foreground hover:border-lime hover:text-lime transition"
                aria-label="Slower"
              >
                −
              </button>
              <div className="px-2 h-7 grid place-items-center text-[9px] uppercase tracking-widest border border-border text-foreground min-w-[52px] tabular-nums">
                {lyricsSpeed.toFixed(2)}×
              </div>
              <button
                type="button"
                onClick={() => setLyricsSpeed(s => Math.min(3, +(s + 0.25).toFixed(2)))}
                className="size-7 grid place-items-center text-[11px] border border-border text-foreground hover:border-lime hover:text-lime transition"
                aria-label="Faster"
              >
                +
              </button>
            </div>
          </div>
          <div
            ref={lyricsRef}
            onWheel={markLyricsUserScroll}
            onTouchStart={markLyricsUserScroll}
            onScroll={handleLyricsScrollEvent}
            className={
              scrollableRehearsal
                ? 'h-[50vh] overflow-y-auto scrollbar-none px-5 py-4'
                : 'flex-1 min-h-0 overflow-y-auto scrollbar-none px-5 py-4'
            }
            style={{ scrollBehavior: 'auto' }}
          >
            {lyricsLines.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-4">No lyrics added yet</p>
            ) : (
              <>
                {lyricsLines.map((line, i) => (
                  line.trim() === ''
                    ? <div key={i} className="h-4" />
                    : (
                      <p key={i} className="font-mono text-[15px] leading-relaxed text-foreground/80">
                        {line}
                      </p>
                    )
                ))}
                {/* Trailing spacer — lets autoscroll keep advancing past the last real
                    line, so it still rises into view for anyone only watching the
                    upper part of the screen instead of stopping dead at the bottom. */}
                <div aria-hidden className="h-[45vh]" />
              </>
            )}
          </div>
        </section>

      </div>

      {/* Fixed master player */}
      <div
        data-tour="mobile-rehearse-transport"
        className={`absolute left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-3 py-2 z-10 ${transportBottom}`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (awaitingPlayback) return
              if (player.playing || isCounting) player.pause()
              else player.play()
            }}
            disabled={player.total === 0}
            className={`size-9 shrink-0 grid place-items-center ${
              awaitingPlayback
                ? 'border border-border bg-background cursor-wait'
                : 'bg-lime text-primary-foreground active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            aria-label={(player.playing || isCounting) ? 'Pause' : awaitingPlayback ? 'Loading' : 'Play'}
          >
            {awaitingPlayback ? (
              <Spinner size={16} tone="lime" />
            ) : (
              <span className="text-base translate-x-px">{(player.playing || isCounting) ? '❚❚' : '▶'}</span>
            )}
          </button>
          <div className="flex-1 grid grid-cols-3 gap-1 min-w-0">
            <RehearsalTransportToggle
              label="Metro"
              active={metronomeOn}
              onClick={onToggleMetronome}
              tooltip="Metronome click track"
            />
            <RehearsalTransportToggle
              label="Count-in"
              active={countdownOn}
              onClick={onToggleCountdown}
              tooltip="One-bar count-in before play"
            />
            <RehearsalTransportToggle
              label="Loop"
              active={sectionLoopOn}
              onClick={onToggleSectionLoop}
              tooltip={sectionLoopOn ? 'Stop looping this section' : 'Loops structure sections only'}
              disabled={!sectionLoopEnabled}
            />
          </div>
          {fullscreen && onToggleFullscreen && (
            <HoverTooltip label="Exit fullscreen" className="shrink-0">
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-label="Exit fullscreen"
                className="size-9 shrink-0 border border-border text-muted-foreground grid place-items-center hover:border-lime hover:text-lime transition"
              >
                <LucideIcon icon={Minimize2} size={13} />
              </button>
            </HoverTooltip>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] font-mono tabular-nums text-muted-foreground shrink-0">{fmt(player.currentTime)}</span>
          <div
            className="flex-1 h-1.5 bg-surface-2 relative cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
            }}
            onTouchEnd={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeek(Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width)))
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-lime/40 transition-[width] duration-75" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${progressPct}%` }} />
          </div>
          <span className="text-[9px] font-mono tabular-nums text-muted-foreground shrink-0">{fmt(player.duration)}</span>
        </div>
      </div>

      {!embedded && showChrome && (
        <div className="absolute bottom-0 left-0 right-0 h-[52px] bg-surface border-t border-border flex items-center justify-center gap-2.5 z-10">
          <span className="rm-rotate-icon" aria-hidden>
            <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
              <rect x="1" y="1" width="16" height="24" rx="3" stroke="var(--lime)" strokeWidth="1.5" />
              <circle cx="9" cy="22" r="1.25" fill="var(--lime)" opacity="0.6" />
            </svg>
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Rotate to open the mixer
          </span>
        </div>
      )}
    </div>
  )
}

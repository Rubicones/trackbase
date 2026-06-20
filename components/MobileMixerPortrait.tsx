'use client'

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sectionLabel } from '@/components/StructureEditor'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import { Spinner } from '@/components/ui/Spinner'
import { decodeWaveformBars } from '@/lib/waveform-decode'
import { waveformBarsCache } from '@/lib/waveformCache'
import { findSectionRangeAtTime } from '@/lib/sectionPlayback'
import type { SectionRange } from '@/lib/sectionPlayback'
import { trackAccentColor } from '@/lib/trackIcon'
import type { RecordState } from '@/components/RecordingTrackRow'
import type { Project, Section, Track } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function sectionStartTime(startBar: number, barDurationMs: number): string {
  return fmt((startBar * barDurationMs) / 1000)
}

function transportBadge(state: RecordState | 'none'): string {
  if (state === 'recording' || state === 'countdown') return '● REC'
  if (state === 'armed') return 'ARMED'
  if (state === 'permitting') return 'MIC…'
  return 'READY'
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </svg>
  )
}

function LoopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function RecordDotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <circle cx="7" cy="7" r="5" />
    </svg>
  )
}

function SkipBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="2.5" y="3.5" width="1.5" height="9" rx="0.3" />
      <path d="M12.5 4.5L7.5 8L12.5 11.5V4.5Z" />
    </svg>
  )
}

function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="12" y="3.5" width="1.5" height="9" rx="0.3" />
      <path d="M3.5 4.5L8.5 8L3.5 11.5V4.5Z" />
    </svg>
  )
}

// ─── Transport button ─────────────────────────────────────────────────────────

function TransportBtn({
  label, children, onClick, active = false, disabled = false, size = 'sm',
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const dim = size === 'md' ? 'size-10' : 'size-9'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${dim} mx-auto border grid place-items-center active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'border-ember bg-ember text-white'
          : 'border-border text-muted-foreground hover:text-ember hover:border-ember'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Track mini waveform bars (static — no playhead re-renders) ───────────────

const TIMELINE_WIDTH_PCT = 180
const TIMELINE_PCT_PER_BAR = 6
const PLAYHEAD_RIGHT_INDENT_PX = 32
const PLAYHEAD_LEFT_INDENT_PX = 16

const TrackMiniWaveformBars = memo(function TrackMiniWaveformBars({
  track, color, muted, totalBars, barDurationMs, projectBpm,
}: {
  track: Track
  color: string
  muted: boolean
  totalBars: number
  barDurationMs: number
  projectBpm?: number
}) {
  const [bars, setBars] = useState<number[] | null>(() => waveformBarsCache.get(track.id) ?? null)
  const isMidi = track.file_type === 'midi'
  const startBar = track.start_bar ?? 0
  const startPct = totalBars > 0 ? (startBar / totalBars) * 100 : 0
  const timelineMs = Math.max(totalBars * barDurationMs, 1)

  useEffect(() => {
    if (isMidi) return
    let cancelled = false
    const cached = waveformBarsCache.get(track.id)
    if (cached) {
      setBars(cached)
      return
    }
    decodeWaveformBars(track.id, 96).then(result => {
      if (!cancelled) setBars(result)
    })
    return () => { cancelled = true }
  }, [track.id, isMidi])

  const barsPerTact = 4
  const tactCount = Math.max(1, Math.ceil(totalBars / barsPerTact))
  const waveOpacity = muted ? 0.35 : 0.75

  return (
    <>
      <div className="absolute inset-0 flex pointer-events-none">
        {Array.from({ length: tactCount }, (_, i) => (
          <div
            key={i}
            className={`flex-1 ${
              (i + 1) % 4 === 0 ? 'border-r border-border/40' : 'border-r border-border/15'
            } last:border-r-0`}
          />
        ))}
      </div>
      {startBar > 0 && !isMidi && (
        <div
          className="absolute inset-y-0 left-0 border-r border-border/50 bg-background/20 pointer-events-none"
          style={{ width: `${startPct}%` }}
        />
      )}
      {isMidi ? (
        track.midi_data ? (
          <div
            className="absolute inset-0"
            style={{ opacity: muted ? 0.35 : 0.85 }}
          >
            <MiniPianoRoll
              midiData={track.midi_data}
              color={color}
              projectBpm={projectBpm}
              totalProjectMs={timelineMs}
              height={56}
              midiStartBar={startBar}
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner size={14} />
          </div>
        )
      ) : bars ? (
        <div
          className="absolute inset-y-1 right-1 flex items-center gap-px"
          style={{ left: `${startPct}%` }}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1"
              style={{
                height: `${Math.max(10, h * 100)}%`,
                background: color,
                opacity: waveOpacity,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-1 flex items-center justify-center">
          <Spinner size={14} />
        </div>
      )}
    </>
  )
})

function TrackWaveformLane({
  track, color, muted, totalBars, progressPct, barDurationMs, projectBpm,
}: {
  track: Track
  color: string
  muted: boolean
  totalBars: number
  progressPct: number
  barDurationMs: number
  projectBpm?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const timelineWidthPct = Math.max(TIMELINE_WIDTH_PCT, totalBars * TIMELINE_PCT_PER_BAR)

  useEffect(() => {
    const playhead = playheadRef.current
    const scrollEl = scrollRef.current
    if (!playhead) return

    playhead.style.left = `${progressPct}%`

    if (!scrollEl) return
    const playheadPx = (progressPct / 100) * scrollEl.scrollWidth
    const viewLeft = scrollEl.scrollLeft
    const viewRight = viewLeft + scrollEl.clientWidth

    if (playheadPx > viewRight - PLAYHEAD_RIGHT_INDENT_PX) {
      scrollEl.scrollLeft = Math.min(
        playheadPx - scrollEl.clientWidth + PLAYHEAD_RIGHT_INDENT_PX,
        scrollEl.scrollWidth - scrollEl.clientWidth,
      )
    } else if (playheadPx < viewLeft + PLAYHEAD_LEFT_INDENT_PX) {
      scrollEl.scrollLeft = Math.max(0, playheadPx - PLAYHEAD_LEFT_INDENT_PX)
    }
  }, [progressPct])

  return (
    <div ref={scrollRef} className="overflow-x-auto scrollbar-none -mx-1 px-1">
      <div
        className="relative h-14 bg-surface/40 border border-border"
        style={{ width: `${timelineWidthPct}%` }}
      >
        <TrackMiniWaveformBars
          track={track}
          color={color}
          muted={muted}
          totalBars={totalBars}
          barDurationMs={barDurationMs}
          projectBpm={projectBpm}
        />
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-px bg-foreground/80 pointer-events-none z-10"
          style={{ left: `${progressPct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Track mini waveform (legacy export name kept for row usage) ──────────────

function TrackMiniWaveform({
  track, color, muted, totalBars, progressPct, barDurationMs, projectBpm,
}: {
  track: Track
  color: string
  muted: boolean
  totalBars: number
  progressPct: number
  barDurationMs: number
  projectBpm?: number
}) {
  return (
    <TrackWaveformLane
      track={track}
      color={color}
      muted={muted}
      totalBars={totalBars}
      progressPct={progressPct}
      barDurationMs={barDurationMs}
      projectBpm={projectBpm}
    />
  )
}

// ─── Track row ────────────────────────────────────────────────────────────────

const MobileMixerTrackRow = memo(function MobileMixerTrackRow({
  track,
  color,
  muted,
  soloed,
  totalBars,
  progressPct,
  barDurationMs,
  projectBpm,
  openMenu,
  onToggleMenu,
  onToggleMute,
  onToggleSolo,
  onReplace,
  onDelete,
}: {
  track: Track
  color: string
  muted: boolean
  soloed: boolean
  totalBars: number
  progressPct: number
  barDurationMs: number
  projectBpm?: number
  openMenu: boolean
  onToggleMenu: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onReplace: () => void
  onDelete: () => void
}) {
  const isMidi = track.file_type === 'midi'
  const badgeLetter = (track.name?.[0] ?? 'T').toUpperCase()
  const startBar = track.start_bar ?? 0

  return (
    <div className="relative border-b border-border">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />

      <div className="pl-3 pr-2 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className="size-7 shrink-0 grid place-items-center text-[10px] font-bold text-background"
            style={{ background: color }}
          >
            {badgeLetter}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold uppercase tracking-tight truncate flex items-center gap-1.5">
              {track.name}
              {isMidi && (
                <span className="text-[8px] tracking-widest border border-border px-1 text-muted-foreground">
                  MIDI
                </span>
              )}
            </div>
            <div className="text-[9px] font-mono text-muted-foreground truncate">
              {isMidi ? 'MIDI track' : (track.original_filename ?? track.name)}
              {startBar > 0 ? ` · bar ${startBar + 1}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            className={`size-7 border text-[10px] font-bold grid place-items-center ${
              muted ? 'bg-foreground text-background border-foreground' : 'border-border hover:border-ember'
            }`}
            aria-label="Mute"
          >
            M
          </button>
          <button
            type="button"
            onClick={onToggleSolo}
            className={`size-7 border text-[10px] font-bold grid place-items-center ${
              soloed ? 'bg-chart-4 text-background border-chart-4' : 'border-border hover:border-chart-4'
            }`}
            aria-label="Solo"
          >
            S
          </button>
          <button
            type="button"
            onClick={onToggleMenu}
            className="size-7 border border-border grid place-items-center hover:border-ember hover:text-ember"
            aria-label="Track options"
          >
            <MoreIcon />
          </button>
        </div>

        <div className="mt-2">
          <TrackMiniWaveform
            track={track}
            color={color}
            muted={muted}
            totalBars={totalBars}
            progressPct={progressPct}
            barDurationMs={barDurationMs}
            projectBpm={projectBpm}
          />
        </div>
      </div>

      {openMenu && (
        <>
          <div className="fixed inset-0 z-20" onClick={onToggleMenu} />
          <div className="absolute right-2 top-12 z-30 w-44 border border-border bg-popover shadow-2xl text-[11px]">
            <button
              type="button"
              onClick={() => { onReplace(); onToggleMenu() }}
              className="w-full text-left px-3 py-2 hover:bg-surface"
            >
              Replace track
            </button>
            <a
              href={`/api/tracks/${track.id}/download`}
              download
              className="block w-full text-left px-3 py-2 hover:bg-surface no-underline text-foreground"
              onClick={onToggleMenu}
            >
              Download
            </a>
            <button
              type="button"
              onClick={() => { onDelete(); onToggleMenu() }}
              className="w-full text-left px-3 py-2 hover:bg-surface text-destructive"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
})

// ─── Main component ───────────────────────────────────────────────────────────

export type MobileMixerPlayer = {
  playing: boolean
  isCounting: boolean
  currentTime: number
  duration: number
  playbackReady: boolean
  play: () => void
  pause: () => void
  seek: (t: number) => void
  sectionLoopOn: boolean
  sectionLoopEnabled: boolean
  onToggleSectionLoop: () => void
}

export type MobileMixerPortraitProps = {
  project: Project
  sections: Section[]
  sectionRanges: SectionRange[]
  activeTracks: Track[]
  totalProjectBars: number
  barDurationMs: number
  player: MobileMixerPlayer
  mutedTracks: Set<string>
  soloedTracks: Set<string>
  midiRenderingTracks: Set<string>
  onToggleMute: (id: string) => void
  onToggleSolo: (id: string) => void
  onAddTrack: () => void
  onAddRecording: () => void
  onReplaceTrack: (track: Track) => void
  onDeleteTrack: (id: string) => void
  onRecordTransport: () => void
  recordingTransportState: RecordState | 'none'
  scrollToRecordingId?: string | null
  onRecordingScrollDone?: () => void
  recordingSlot?: ReactNode
  onExit: () => void
}

export function MobileMixerPortrait({
  project,
  sections,
  sectionRanges,
  activeTracks,
  totalProjectBars,
  barDurationMs,
  player,
  mutedTracks,
  soloedTracks,
  midiRenderingTracks,
  onToggleMute,
  onToggleSolo,
  onAddTrack,
  onAddRecording,
  onReplaceTrack,
  onDeleteTrack,
  onRecordTransport,
  recordingTransportState,
  scrollToRecordingId,
  onRecordingScrollDone,
  recordingSlot,
  onExit,
}: MobileMixerPortraitProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionsScrollRef = useRef<HTMLDivElement>(null)
  const sectionBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const projBarDurationSec = barDurationMs / 1000
  const playheadBar = projBarDurationSec > 0
    ? Math.ceil(player.currentTime / projBarDurationSec)
    : 0
  const mobileTimelineBars = Math.max(totalProjectBars, playheadBar + 4)
  const timelineDurationSec = mobileTimelineBars * projBarDurationSec
  const progressPct = timelineDurationSec > 0
    ? Math.min(100, (player.currentTime / timelineDurationSec) * 100)
    : 0

  const activeSectionIdx = useMemo(() => {
    const range = findSectionRangeAtTime(sectionRanges, player.currentTime, projBarDurationSec)
    if (!range) return 0
    const idx = sections.findIndex(s => s.id === range.id)
    return idx === -1 ? 0 : idx
  }, [sectionRanges, player.currentTime, projBarDurationSec, sections])

  const activeSection = sections[activeSectionIdx]
  const isReady = player.duration > 0 && player.playbackReady
  const awaitingPlayback = player.duration > 0 && !player.playbackReady
  const isPlaying = player.playing || player.isCounting
  const isRecording = recordingTransportState === 'recording' || recordingTransportState === 'countdown'
  const isArmed = recordingTransportState === 'armed'
  const isPermitting = recordingTransportState === 'permitting'
  const badge = transportBadge(recordingTransportState)

  useEffect(() => {
    const section = sections[activeSectionIdx]
    if (!section) return
    const btn = sectionBtnRefs.current.get(section.id)
    const container = sectionsScrollRef.current
    if (!btn || !container) return

    const btnLeft = btn.offsetLeft
    const btnRight = btnLeft + btn.offsetWidth
    const viewLeft = container.scrollLeft
    const viewRight = viewLeft + container.clientWidth
    const pad = 8

    if (btnLeft < viewLeft + pad) {
      container.scrollTo({ left: Math.max(0, btnLeft - pad), behavior: 'smooth' })
    } else if (btnRight > viewRight - pad) {
      container.scrollTo({
        left: Math.max(0, btnRight - container.clientWidth + pad),
        behavior: 'smooth',
      })
    }
  }, [activeSectionIdx, sections])

  useEffect(() => {
    if (!scrollToRecordingId) return
    const id = scrollToRecordingId
    let cancelled = false
    let attempts = 0

    const tryScroll = () => {
      if (cancelled || attempts > 12) {
        if (!cancelled) onRecordingScrollDone?.()
        return
      }
      attempts++
      const el = document.querySelector(`[data-recording-id="${id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        onRecordingScrollDone?.()
      } else {
        requestAnimationFrame(tryScroll)
      }
    }

    tryScroll()
    return () => { cancelled = true }
  }, [scrollToRecordingId, recordingSlot, onRecordingScrollDone])

  function seekToSection(section: Section) {
    player.seek((section.start_bar * barDurationMs) / 1000 + 0.001)
  }

  function handleSeekRatio(ratio: number) {
    player.seek(ratio * player.duration)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Sub-header: exit, song meta, +track */}
      <div className="px-3 py-2 border-b border-border bg-background flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to rehearsal"
          className="size-8 border border-border grid place-items-center hover:border-ember hover:text-ember"
        >
          <ChevronLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-widest truncate">{project.name}</div>
          <div className="text-[9px] font-mono tabular-nums text-muted-foreground flex gap-2">
            {project.bpm != null && <span>{project.bpm} BPM</span>}
            {project.key && <span className="text-ember">{project.key}</span>}
            <span>{project.time_signature ?? '4/4'}</span>
            <span>{activeTracks.length} TRK</span>
          </div>
        </div>
      </div>

      {/* Section pills strip */}
      <div className="border-b border-border bg-surface/30 px-3 py-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Section</span>
          {activeSection && (
            <span className="text-[9px] font-mono tabular-nums text-ember">
              ● {sectionLabel(activeSection)} · {sectionStartTime(activeSection.start_bar, barDurationMs)}
            </span>
          )}
        </div>
        <div ref={sectionsScrollRef} className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-3 px-3 pb-1">
          {sections.map((s, i) => {
            const active = i === activeSectionIdx
            return (
              <button
                key={s.id}
                ref={el => {
                  if (el) sectionBtnRefs.current.set(s.id, el)
                  else sectionBtnRefs.current.delete(s.id)
                }}
                type="button"
                onClick={() => seekToSection(s)}
                className={`shrink-0 px-2.5 py-1.5 border text-[10px] uppercase tracking-widest transition ${
                  active
                    ? 'bg-ember text-white border-ember'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
                title={`Bars ${s.start_bar}–${s.end_bar}`}
              >
                <div className="font-bold">{sectionLabel(s)}</div>
                <div className="text-[8px] font-mono tabular-nums opacity-80">
                  {sectionStartTime(s.start_bar, barDurationMs)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tracks list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background min-h-0">
        {activeTracks.map((t, i) => {
          const color = trackAccentColor(t.icon_color, i)
          const muted = mutedTracks.has(t.id) || midiRenderingTracks.has(t.id)
          const soloed = soloedTracks.has(t.id)
          return (
            <MobileMixerTrackRow
              key={t.id}
              track={t}
              color={color}
              muted={muted}
              soloed={soloed}
              totalBars={mobileTimelineBars}
              progressPct={progressPct}
              barDurationMs={barDurationMs}
              projectBpm={project.bpm ?? undefined}
              openMenu={openMenuId === t.id}
              onToggleMenu={() => setOpenMenuId(prev => (prev === t.id ? null : t.id))}
              onToggleMute={() => onToggleMute(t.id)}
              onToggleSolo={() => onToggleSolo(t.id)}
              onReplace={() => onReplaceTrack(t)}
              onDelete={() => onDeleteTrack(t.id)}
            />
          )
        })}

        {recordingSlot}

        <div className="px-3 py-2 space-y-2">
          <button
            type="button"
            onClick={onAddTrack}
            className="w-full border border-dashed border-border px-3 py-4 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ember hover:border-ember flex items-center justify-center gap-2 bg-background"
          >
            <span className="text-base leading-none">+</span>
            Add audio / MIDI / loop
          </button>
          <button
            type="button"
            onClick={onAddRecording}
            className="w-full border border-dashed border-border px-3 py-3 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-destructive hover:border-destructive flex items-center justify-center gap-2 bg-background"
          >
            <span className="inline-block size-2 rounded-full bg-destructive shrink-0" />
            Record track
          </button>
        </div>

        <div className="h-36" />
      </div>

      {/* Bottom transport */}
      <div className="border-t border-border bg-surface/95 backdrop-blur shrink-0">
        <div className="px-4 pt-2.5">
          <div className="flex items-center justify-between text-[9px] font-mono tabular-nums mb-1.5">
            <span className="text-foreground">{fmt(player.currentTime)}</span>
            <span
              className={`uppercase tracking-widest text-[8.5px] px-1.5 py-px border ${
                isRecording
                  ? 'border-destructive text-destructive font-bold animate-pulse'
                  : isArmed
                    ? 'border-destructive/60 text-destructive'
                    : 'border-border text-muted-foreground'
              }`}
            >
              {badge}
            </span>
            <span className="text-muted-foreground">{fmt(player.duration)}</span>
          </div>
          <div
            className="h-1 bg-surface-2 relative cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeekRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
            }}
            onTouchEnd={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeekRatio(Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width)))
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-ember" style={{ width: `${progressPct}%` }} />
            <div className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-foreground" style={{ left: `${progressPct}%` }} />
          </div>
        </div>

        <div className="px-3 py-2.5 grid grid-cols-5 items-center gap-1.5">
          <TransportBtn label="Rewind to start" onClick={() => player.seek(0)}>
            <SkipBackIcon />
          </TransportBtn>
          <button
            type="button"
            onClick={onRecordTransport}
            disabled={isPermitting}
            className={`mx-auto size-10 rounded-full grid place-items-center border-2 transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              isRecording
                ? 'bg-destructive border-destructive text-white animate-pulse'
                : isArmed
                  ? 'bg-background border-destructive text-destructive hover:bg-destructive hover:text-white'
                  : 'bg-background border-destructive/70 text-destructive hover:bg-destructive hover:text-white hover:border-destructive'
            }`}
            aria-label={isRecording ? 'Stop recording' : isArmed ? 'Start recording' : 'Arm and record'}
            title={isRecording ? 'Stop' : isArmed ? 'Record' : 'Arm microphone'}
          >
            <RecordDotIcon />
          </button>
          <button
            type="button"
            onClick={() => (isPlaying ? player.pause() : player.play())}
            disabled={!isReady && player.duration > 0}
            className="mx-auto size-12 bg-ember text-white grid place-items-center hover:brightness-110 active:scale-95 transition disabled:opacity-50"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {awaitingPlayback ? (
              <Spinner size={20} tone="white" />
            ) : isPlaying ? (
              <PauseIcon />
            ) : (
              <PlayIcon />
            )}
          </button>
          <TransportBtn
            label="Loop section"
            size="md"
            active={player.sectionLoopOn}
            disabled={!player.sectionLoopEnabled}
            onClick={player.onToggleSectionLoop}
          >
            <LoopIcon />
          </TransportBtn>
          <TransportBtn label="Skip to end" onClick={() => player.seek(player.duration)}>
            <SkipForwardIcon />
          </TransportBtn>
        </div>
      </div>
    </div>
  )
}

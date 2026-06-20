'use client'

import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { sectionLabel, SectionEditPopover, useSectionEditActions } from '@/components/StructureEditor'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import { MobileMixerVersionBar } from '@/components/MobileMixerVersionBar'
import { MobileTrackColorPicker } from '@/components/MobileTrackColorPicker'
import {
  MobileTimelineScrollProvider,
  useMobileTimelineScroll,
  useRegisterTimelineScroll,
} from '@/components/MobileTimelineScrollSync'
import {
  MobileWaveformComments,
  type MobileActiveCommentInput,
} from '@/components/MobileWaveformComments'
import { MetronomeIcon, CountInMark } from '@/components/design/TransportIcons'
import { Spinner } from '@/components/ui/Spinner'
import { decodeWaveformBars } from '@/lib/waveform-decode'
import { waveformBarsCache } from '@/lib/waveformCache'
import { findSectionRangeAtTime } from '@/lib/sectionPlayback'
import type { SectionRange } from '@/lib/sectionPlayback'
import { trackAccentColor } from '@/lib/trackIcon'
import type { RecordState } from '@/components/RecordingTrackRow'
import type { Project, Section, Track, TrackComment, Version } from '@/lib/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function sectionStartTime(startBar: number, barDurationMs: number): string {
  return fmt((startBar * barDurationMs) / 1000)
}

function sectionTimeRange(startBar: number, endBar: number, barDurationMs: number): string {
  return `${sectionStartTime(startBar, barDurationMs)}–${sectionStartTime(endBar, barDurationMs)}`
}

function transportBadge(state: RecordState | 'none'): string {
  if (state === 'recording' || state === 'countdown') return '● REC'
  if (state === 'armed') return 'ARMED'
  if (state === 'permitting') return 'MIC…'
  return 'READY'
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
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

// ─── Transport button ─────────────────────────────────────────────────────────

function TransportBtn({
  label, children, onClick, active = false, disabled = false, size = 'sm', wide = false,
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  wide?: boolean
}) {
  const dim = size === 'md' ? 'size-10' : 'size-9'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${wide ? 'h-9 min-w-[52px] px-2' : dim} mx-auto border grid place-items-center active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed ${
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
  timelineDurationMs, commentMode, comments, activeCommentInput,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseCommentInput,
  onReplyCreate, currentUserId, isOwner, currentUser,
}: {
  track: Track
  color: string
  muted: boolean
  totalBars: number
  progressPct: number
  barDurationMs: number
  projectBpm?: number
  timelineDurationMs: number
  commentMode: boolean
  comments: TrackComment[]
  activeCommentInput: MobileActiveCommentInput | null
  onCommentPlace: (input: MobileActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseCommentInput: () => void
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUserId: string | undefined
  isOwner: boolean
  currentUser: { username: string } | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const scrollSync = useMobileTimelineScroll()
  useRegisterTimelineScroll(scrollRef)
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

    let nextScroll = scrollEl.scrollLeft
    if (playheadPx > viewRight - PLAYHEAD_RIGHT_INDENT_PX) {
      nextScroll = Math.min(
        playheadPx - scrollEl.clientWidth + PLAYHEAD_RIGHT_INDENT_PX,
        scrollEl.scrollWidth - scrollEl.clientWidth,
      )
    } else if (playheadPx < viewLeft + PLAYHEAD_LEFT_INDENT_PX) {
      nextScroll = Math.max(0, playheadPx - PLAYHEAD_LEFT_INDENT_PX)
    }

    if (nextScroll !== scrollEl.scrollLeft) {
      scrollEl.scrollLeft = nextScroll
      scrollSync?.syncTo(nextScroll, scrollEl)
    }
  }, [progressPct, scrollSync])

  return (
    <div ref={scrollRef} className="overflow-x-auto scrollbar-none -mx-1 px-1">
      <div
        ref={timelineRef}
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
        <MobileWaveformComments
          trackId={track.id}
          durationMs={timelineDurationMs}
          comments={comments}
          commentMode={commentMode}
          activeInput={activeCommentInput}
          timelineRef={timelineRef}
          scrollRef={scrollRef}
          onCommentPlace={onCommentPlace}
          onCommentDelete={onCommentDelete}
          onCommentCreate={onCommentCreate}
          onCloseInput={onCloseCommentInput}
          onReplyCreate={onReplyCreate}
          currentUserId={currentUserId}
          isOwner={isOwner}
          currentUser={currentUser}
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
  timelineDurationMs, commentMode, comments, activeCommentInput,
  onCommentPlace, onCommentDelete, onCommentCreate, onCloseCommentInput,
  onReplyCreate, currentUserId, isOwner, currentUser,
}: {
  track: Track
  color: string
  muted: boolean
  totalBars: number
  progressPct: number
  barDurationMs: number
  projectBpm?: number
  timelineDurationMs: number
  commentMode: boolean
  comments: TrackComment[]
  activeCommentInput: MobileActiveCommentInput | null
  onCommentPlace: (input: MobileActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseCommentInput: () => void
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUserId: string | undefined
  isOwner: boolean
  currentUser: { username: string } | null
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
      timelineDurationMs={timelineDurationMs}
      commentMode={commentMode}
      comments={comments}
      activeCommentInput={activeCommentInput}
      onCommentPlace={onCommentPlace}
      onCommentDelete={onCommentDelete}
      onCommentCreate={onCommentCreate}
      onCloseCommentInput={onCloseCommentInput}
      onReplyCreate={onReplyCreate}
      currentUserId={currentUserId}
      isOwner={isOwner}
      currentUser={currentUser}
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
  timelineDurationMs,
  commentMode,
  comments,
  activeCommentInput,
  onCommentPlace,
  onCommentDelete,
  onCommentCreate,
  onCloseCommentInput,
  onReplyCreate,
  currentUserId,
  isOwner,
  currentUser,
  openMenu,
  colorPickerOpen,
  onToggleMenu,
  onToggleMute,
  onToggleSolo,
  onOpenColorPicker,
  onColorApply,
  onCloseColorPicker,
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
  timelineDurationMs: number
  commentMode: boolean
  comments: TrackComment[]
  activeCommentInput: MobileActiveCommentInput | null
  onCommentPlace: (input: MobileActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseCommentInput: () => void
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUserId: string | undefined
  isOwner: boolean
  currentUser: { username: string } | null
  openMenu: boolean
  colorPickerOpen: boolean
  onToggleMenu: () => void
  onToggleMute: () => void
  onToggleSolo: () => void
  onOpenColorPicker: () => void
  onColorApply: (color: string) => void
  onCloseColorPicker: () => void
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
          <button
            type="button"
            onClick={onOpenColorPicker}
            className="size-7 shrink-0 grid place-items-center text-[10px] font-bold text-background"
            style={{ background: color }}
            aria-label="Change track color"
          >
            {badgeLetter}
          </button>
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
            timelineDurationMs={timelineDurationMs}
            commentMode={commentMode}
            comments={comments}
            activeCommentInput={activeCommentInput}
            onCommentPlace={onCommentPlace}
            onCommentDelete={onCommentDelete}
            onCommentCreate={onCommentCreate}
            onCloseCommentInput={onCloseCommentInput}
            onReplyCreate={onReplyCreate}
            currentUserId={currentUserId}
            isOwner={isOwner}
            currentUser={currentUser}
          />
        </div>
      </div>

      {colorPickerOpen && (
        <MobileTrackColorPicker
          trackId={track.id}
          initialColor={color}
          badgeLetter={badgeLetter}
          onApply={onColorApply}
          onClose={onCloseColorPicker}
        />
      )}

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
  metronomeOn: boolean
  countdownOn: boolean
  onToggleMetronome: () => void
  onToggleCountdown: () => void
}

export type MobileMixerPortraitProps = {
  project: Project
  versionId: string
  versions: Version[]
  activeVersionId: string
  onVersionChange: (id: string) => void
  onNewBranch: () => void
  sections: Section[]
  onSectionsChange: Dispatch<SetStateAction<Section[]>>
  sectionRanges: SectionRange[]
  activeTracks: Track[]
  totalProjectBars: number
  totalDurationMs: number
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
  onColorUpdate: (trackId: string, color: string) => void
  onRecordTransport: () => void
  recordingTransportState: RecordState | 'none'
  scrollToRecordingId?: string | null
  onRecordingScrollDone?: () => void
  recordingSlot?: ReactNode
  commentMode: boolean
  onToggleCommentMode: () => void
  commentCount: number
  activeCommentInput: MobileActiveCommentInput | null
  onCommentPlace: (input: MobileActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseCommentInput: () => void
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUserId: string | undefined
  isOwner: boolean
  currentUser: { username: string } | null
}

export function MobileMixerPortrait(props: MobileMixerPortraitProps) {
  return (
    <MobileTimelineScrollProvider>
      <MobileMixerPortraitInner {...props} />
    </MobileTimelineScrollProvider>
  )
}

function MobileMixerPortraitInner({
  project,
  versionId,
  versions,
  activeVersionId,
  onVersionChange,
  onNewBranch,
  sections,
  onSectionsChange,
  sectionRanges,
  activeTracks,
  totalProjectBars,
  totalDurationMs,
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
  onColorUpdate,
  onRecordTransport,
  recordingTransportState,
  scrollToRecordingId,
  onRecordingScrollDone,
  recordingSlot,
  commentMode,
  onToggleCommentMode,
  commentCount,
  activeCommentInput,
  onCommentPlace,
  onCommentDelete,
  onCommentCreate,
  onCloseCommentInput,
  onReplyCreate,
  currentUserId,
  isOwner,
  currentUser,
}: MobileMixerPortraitProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [colorPickerTrackId, setColorPickerTrackId] = useState<string | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionsScrollRef = useRef<HTMLDivElement>(null)
  const sectionBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const sectionActions = useSectionEditActions({
    project,
    versionId,
    tracks: activeTracks,
    sections,
    onSectionsChange,
    totalDurationMs,
  })
  const editingSection = editingSectionId
    ? sections.find(s => s.id === editingSectionId)
    : undefined

  const projBarDurationSec = barDurationMs / 1000
  const playheadBar = projBarDurationSec > 0
    ? Math.ceil(player.currentTime / projBarDurationSec)
    : 0
  const mobileTimelineBars = Math.max(totalProjectBars, playheadBar + 4)
  const timelineDurationSec = mobileTimelineBars * projBarDurationSec
  const timelineDurationMs = timelineDurationSec * 1000
  const progressPct = timelineDurationSec > 0
    ? Math.min(100, (player.currentTime / timelineDurationSec) * 100)
    : 0

  const activeSectionIdx = useMemo(() => {
    const range = findSectionRangeAtTime(sectionRanges, player.currentTime, projBarDurationSec)
    if (!range) return -1
    const idx = sections.findIndex(s => s.id === range.id)
    return idx === -1 ? -1 : idx
  }, [sectionRanges, player.currentTime, projBarDurationSec, sections])

  const activeSection = activeSectionIdx >= 0 ? sections[activeSectionIdx] : undefined
  const isReady = player.duration > 0 && player.playbackReady
  const awaitingPlayback = player.duration > 0 && !player.playbackReady
  const isPlaying = player.playing || player.isCounting
  const isRecording = recordingTransportState === 'recording' || recordingTransportState === 'countdown'
  const isArmed = recordingTransportState === 'armed'
  const isPermitting = recordingTransportState === 'permitting'
  const badge = transportBadge(recordingTransportState)

  useEffect(() => {
    if (activeSectionIdx < 0) return
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

  function handleSectionClick(section: Section, isActive: boolean) {
    if (isActive) {
      setEditingSectionId(section.id)
    } else {
      seekToSection(section)
    }
  }

  function handleSeekRatio(ratio: number) {
    player.seek(ratio * player.duration)
  }

  const waveformCommentProps = {
    timelineDurationMs,
    commentMode,
    activeCommentInput,
    onCommentPlace,
    onCommentDelete,
    onCommentCreate,
    onCloseCommentInput,
    onReplyCreate,
    currentUserId,
    isOwner,
    currentUser,
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <MobileMixerVersionBar
        versions={versions}
        activeId={activeVersionId}
        onSelect={onVersionChange}
        onNewBranch={onNewBranch}
        commentMode={commentMode}
        commentCount={commentCount}
        onToggleCommentMode={onToggleCommentMode}
      />

      {commentMode && (
        <div className="px-3 py-1.5 border-b border-ember/30 bg-ember-soft shrink-0">
          <span className="text-[9px] uppercase tracking-widest text-ember">
            ● Comment mode — tap and drag on a waveform
          </span>
        </div>
      )}

      {/* Section pills strip */}
      <div className="border-b border-border bg-surface/30 px-3 py-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Section</span>
          {activeSection && (
            <span className="text-[9px] font-mono tabular-nums text-ember">
              ● {sectionLabel(activeSection)} · {sectionTimeRange(activeSection.start_bar, activeSection.end_bar, barDurationMs)}
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
                onClick={() => handleSectionClick(s, active)}
                className={`shrink-0 px-2.5 py-1.5 border text-[10px] uppercase tracking-widest transition ${
                  active
                    ? 'bg-ember text-white border-ember'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
                title={`Bars ${s.start_bar + 1}–${s.end_bar}`}
              >
                <div className="font-bold">{sectionLabel(s)}</div>
                <div className="text-[8px] font-mono tabular-nums opacity-80">
                  {sectionTimeRange(s.start_bar, s.end_bar, barDurationMs)}
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
              comments={t.comments ?? []}
              {...waveformCommentProps}
              openMenu={openMenuId === t.id}
              colorPickerOpen={colorPickerTrackId === t.id}
              onToggleMenu={() => setOpenMenuId(prev => (prev === t.id ? null : t.id))}
              onToggleMute={() => onToggleMute(t.id)}
              onToggleSolo={() => onToggleSolo(t.id)}
              onOpenColorPicker={() => setColorPickerTrackId(prev => (prev === t.id ? null : t.id))}
              onColorApply={c => onColorUpdate(t.id, c)}
              onCloseColorPicker={() => setColorPickerTrackId(null)}
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

        <div className="h-40" />
      </div>

      {/* Bottom transport */}
      <div className="border-t border-border bg-surface/95 backdrop-blur shrink-0 pb-[env(safe-area-inset-bottom)]">
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-2">
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
            className="relative py-3 -my-1 touch-none"
            onClick={e => {
              const bar = e.currentTarget.querySelector('[data-scrub-bar]') as HTMLElement | null
              if (!bar) return
              const rect = bar.getBoundingClientRect()
              handleSeekRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
            }}
            onTouchEnd={e => {
              const bar = e.currentTarget.querySelector('[data-scrub-bar]') as HTMLElement | null
              if (!bar) return
              const rect = bar.getBoundingClientRect()
              handleSeekRatio(Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width)))
            }}
          >
            <div
              data-scrub-bar
              className="h-2 bg-surface-2 relative cursor-pointer"
            >
              <div className="absolute inset-y-0 left-0 bg-ember" style={{ width: `${progressPct}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-foreground"
                style={{ left: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="px-3 pt-1 pb-2.5 grid grid-cols-5 items-center gap-1.5">
          <TransportBtn
            label="Metronome"
            active={player.metronomeOn}
            onClick={player.onToggleMetronome}
          >
            <MetronomeIcon size={16} />
          </TransportBtn>
          <TransportBtn
            label="Count-in"
            active={player.countdownOn}
            onClick={player.onToggleCountdown}
            wide
          >
            <CountInMark />
          </TransportBtn>
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
          >
            <RecordDotIcon />
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
        </div>
      </div>

      {editingSection && (
        <SectionEditPopover
          layout="sheet"
          section={editingSection}
          cellPos={{ left: 0, top: 0, width: 320, height: 0 }}
          detectingChords={sectionActions.detectingChordsFor === editingSection.id}
          audioTracks={sectionActions.audioTracks}
          totalBars={sectionActions.totalBars}
          onTypeChange={sectionActions.handleTypeChange}
          onChordsLocalChange={sectionActions.handleChordsLocalChange}
          onChordsAutoSave={sectionActions.handleChordsAutoSave}
          onDetectChords={ids => sectionActions.handleDetectChords(editingSection.id, ids)}
          onBarRangeChange={sectionActions.handleBarRangeChange}
          onDelete={id => { sectionActions.handleDelete(id); setEditingSectionId(null) }}
          onClose={() => setEditingSectionId(null)}
        />
      )}
    </div>
  )
}

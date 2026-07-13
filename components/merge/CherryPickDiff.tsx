'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Project, Section, Track, TrackComment, Version } from '@/lib/types'
import type { ConflictTrack, MergePreview, MergeResolution } from '@/lib/mergePreview'
import { useMergePreview } from '@/components/merge/useMergePreview'
import { MergePreviewLoading } from '@/components/merge/MergeTargetSelector'
import { useCompareAudio, BarRuler, type ABMode } from '@/components/CompareMode'
import {
  buildBarMap,
  barMapToSections,
  calculateTotalBars,
  type BarState,
  type ConflictRange,
  type AutoBarRange,
} from '@/lib/sectionMerge'
import { barOffsetToMs } from '@/lib/commentTimecodes'
import { formatTrackStartBar } from '@/lib/trackMerge'
import { trackAccentColor } from '@/lib/trackIcon'
import { trackEvent } from '@/lib/analytics'
import { waveformBarsCache } from '@/lib/waveformCache'
import { WaveformBarsPlayhead, playedPctStyle } from '@/components/WaveformBars'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import { CommentTooltip } from '@/components/CommentTooltip'
import { SectionLabel } from '@/components/design/AppShell'

// ─── Constants ────────────────────────────────────────────────────────────────

const LABEL_W = 200
const MONO_CLIP_COLOR = 'rgba(128,128,128,0.55)'

// Change-id namespace:
//   track:<name>            track change from the version (cherry-pickable)
//   trackdel:<name>         OPT-IN removal of a target-only track — never part
//                           of select-all / group toggles, off by default
//   sec:<start>-<end>       structure range (cherry-pickable)
//   com:add:<id>            comment added in version (cherry-pickable)
//   com:del:<id>            comment deleted in version (cherry-pickable)
type ChangeId = string

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function barStateLabel(state: BarState | null): string {
  if (!state) return 'cleared'
  if (state.type === 'custom' && state.customName) return state.customName
  return state.type.charAt(0).toUpperCase() + state.type.slice(1)
}

function trackTitle(t: { display_name?: string | null; name: string }): string {
  return t.display_name?.trim() || t.name
}

function rangeId(r: { startBar: number; endBar: number }): ChangeId {
  return `sec:${r.startBar}-${r.endBar}`
}

function rangeKey(r: { startBar: number; endBar: number }): string {
  return `${r.startBar}-${r.endBar}`
}

// ─── Change model built from the merge preview ────────────────────────────────

interface TrackChangeInfo {
  trackName: string
  /** Non-conflicting change coming from the version. */
  auto: boolean
  isNew: boolean
  fileFromBranch: boolean
  newDisplayName?: string
  newStartBar?: number
  previousStartBar?: number
  conflict?: ConflictTrack
  /** Guardrail: the target's copy of this track is newer than the version's. */
  targetNewer?: boolean
  notes: string[]
}

function buildTrackChanges(preview: MergePreview): Map<string, TrackChangeInfo> {
  const map = new Map<string, TrackChangeInfo>()

  for (const item of preview.autoMerge) {
    let info = map.get(item.trackName)
    if (!info) {
      info = { trackName: item.trackName, auto: true, isNew: false, fileFromBranch: false, notes: [] }
      map.set(item.trackName, info)
    }
    if (item.targetNewer) info.targetNewer = true
    if (item.action === 'add_new') {
      info.isNew = true
      info.fileFromBranch = true
      info.notes.push('new track')
    }
    if (item.action === 'take_from_branch') {
      info.fileFromBranch = true
      info.notes.push('audio replaced from version')
    }
    if (item.action === 'apply_rename') {
      info.newDisplayName = item.newDisplayName
      info.notes.push(`renamed → “${item.newDisplayName}”`)
    }
    if (item.action === 'apply_offset') {
      info.newStartBar = item.newStartBar
      info.previousStartBar = item.previousStartBar
      info.notes.push(`starts at ${formatTrackStartBar(item.previousStartBar ?? 0)} → ${formatTrackStartBar(item.newStartBar ?? 0)}`)
    }
  }

  for (const conflict of preview.conflicts) {
    const kinds: string[] = []
    if (conflict.fileConflict) kinds.push('file')
    if (conflict.renameConflict) kinds.push('name')
    if (conflict.offsetConflict) kinds.push('offset')
    map.set(conflict.trackName, {
      trackName: conflict.trackName,
      auto: false,
      isNew: false,
      fileFromBranch: false,
      conflict,
      notes: [`${kinds.join(' + ')} overlap — pick a side`],
    })
  }

  return map
}

type SectionRangeKind = 'added' | 'removed' | 'modified'

function classifySectionRange(
  range: { startBar: number; endBar: number },
  targetMap: (BarState | null)[],
  branchState: BarState | null,
): SectionRangeKind {
  const targetHasContent = targetMap
    .slice(range.startBar, range.endBar)
    .some(s => s !== null)
  if (!branchState) return targetHasContent ? 'removed' : 'modified'
  if (!targetHasContent) return 'added'
  return 'modified'
}

// ─── Small UI primitives ──────────────────────────────────────────────────────

function PickCheckbox({
  on, indeterminate, onClick, size = 12, removed,
}: {
  on: boolean
  indeterminate?: boolean
  onClick: (e: React.MouseEvent) => void
  size?: number
  removed?: boolean
}) {
  const accent = removed ? 'var(--destructive)' : 'var(--lime)'
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(e) }}
      className="grid place-items-center border transition-colors shrink-0"
      style={{
        width: size,
        height: size,
        background: on ? accent : 'transparent',
        borderColor: on || indeterminate ? accent : 'var(--border)',
      }}
      aria-pressed={on}
    >
      {on && (
        <svg viewBox="0 0 10 10" className="w-full h-full">
          <path d="M2 5 L4.2 7.2 L8 3" stroke="var(--primary-foreground, #000)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {!on && indeterminate && <span className="block w-1.5 h-px" style={{ background: accent }} />}
    </button>
  )
}

function ChoicePair({
  label, mainLabel, branchLabel, choice, onChoose,
}: {
  label: string
  mainLabel: string
  branchLabel: string
  choice: 'main' | 'branch'
  onChoose: (c: 'main' | 'branch') => void
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[8px] uppercase tracking-widest text-muted-foreground w-9 shrink-0">{label}</span>
      <div className="flex border border-border min-w-0">
        {([['main', mainLabel], ['branch', branchLabel]] as const).map(([side, text], i) => {
          const sel = choice === side
          return (
            <button
              key={side}
              type="button"
              onClick={() => onChoose(side)}
              title={text}
              className={`text-[8px] uppercase tracking-widest px-1.5 py-0.5 truncate max-w-[74px] transition ${
                i === 0 ? 'border-r border-border' : ''
              } ${sel ? 'bg-lime text-primary-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DiffLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[8px] uppercase tracking-widest text-muted-foreground">
      <span className="flex items-center gap-1"><span className="size-2" style={{ background: MONO_CLIP_COLOR }} /> target</span>
      <span className="flex items-center gap-1"><span className="size-2 bg-lime" /> incoming</span>
      <span className="flex items-center gap-1"><span className="size-2 bg-destructive" /> removed</span>
      <span className="flex items-center gap-1"><span className="size-2 border border-border bg-transparent" /> skipped</span>
    </div>
  )
}

// ─── Changes panel (left toolbar replacement) ─────────────────────────────────

function ChangeGroup({
  label, count, allOn, anyOn, onToggleAll, open, onToggle, children,
}: {
  label: string
  count: number
  allOn: boolean
  anyOn: boolean
  onToggleAll: () => void
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="border-b border-border">
      <div className="flex items-center px-3 py-2 gap-2">
        {count > 0
          ? <PickCheckbox on={allOn} indeterminate={!allOn && anyOn} onClick={onToggleAll} />
          : <span className="size-3 shrink-0" />}
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center justify-between text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition"
        >
          <span className="flex items-center gap-1.5">
            <span className={`inline-block transition-transform text-[8px] ${open ? 'rotate-90' : ''}`}>▸</span>
            {label}
          </span>
          <span className="text-foreground tabular-nums">{count}</span>
        </button>
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

/** Guardrail chip — the target's content is more recent than the version's. */
function TargetNewerChip() {
  return (
    <span
      className="shrink-0 text-[7px] font-bold uppercase tracking-widest px-1 py-px border border-destructive/40 text-destructive bg-destructive/10"
      title="The target changed this after the version being applied — applying overwrites newer work"
    >
      Target newer
    </span>
  )
}

function PickRow({
  on, onToggle, sign, title, detail, removed, warn, children,
}: {
  on: boolean
  onToggle: () => void
  sign: '+' | '−' | '~'
  title: ReactNode
  detail?: string
  removed?: boolean
  /** Guardrail: the target's side of this change is newer than the version's. */
  warn?: boolean
  children?: ReactNode
}) {
  const accent = removed ? 'var(--destructive)' : 'var(--lime)'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      className={`w-full text-left px-3 py-1.5 border-l-2 flex gap-2 items-start cursor-pointer transition-all ${
        on ? (removed ? 'bg-destructive/5' : 'bg-lime-soft/30') : 'opacity-45 hover:opacity-80'
      }`}
      style={{ borderLeftColor: on ? accent : 'transparent' }}
    >
      <span className="mt-0.5"><PickCheckbox on={on} onClick={onToggle} removed={removed} /></span>
      <span className="font-mono text-[10px] w-2.5 text-center shrink-0 mt-px" style={{ color: accent }}>{sign}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[10px] font-bold uppercase tracking-tight truncate ${removed && on ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
            {title}
          </span>
          {warn && <span className="ml-auto"><TargetNewerChip /></span>}
        </div>
        {detail && <div className="text-[9px] text-muted-foreground mt-0.5 leading-tight break-words">{detail}</div>}
        {children}
      </div>
    </div>
  )
}

function ConflictRow({
  title, resolvedBadge, children,
}: {
  title: ReactNode
  resolvedBadge: string
  children: ReactNode
}) {
  return (
    <div className="w-full text-left px-3 py-1.5 border-l-2 border-l-destructive/70 bg-destructive/[0.04] flex gap-2 items-start">
      <span className="font-mono text-[10px] w-2.5 text-center shrink-0 mt-px text-destructive">!</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-tight truncate text-foreground">{title}</span>
          <span className="ml-auto shrink-0 text-[7px] font-bold uppercase tracking-widest px-1 py-px border border-destructive/40 text-destructive bg-destructive/10">
            {resolvedBadge}
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-1">{children}</div>
      </div>
    </div>
  )
}

// ─── Diff comment marker — mixer-identical visuals ────────────────────────────

type CommentChangeKind = 'added' | 'deleted' | null

function DiffCommentMarker({
  comment, clipDurationMs, changeKind, picked, onToggle, projectOffsetMs,
}: {
  comment: TrackComment
  clipDurationMs: number
  /** null = unchanged comment; 'added' = new in version; 'deleted' = removed in version. */
  changeKind: CommentChangeKind
  picked: boolean
  onToggle: () => void
  projectOffsetMs: number
}) {
  const startPct = clipDurationMs > 0 ? (comment.timecode_start_ms / clipDurationMs) * 100 : 0
  const endPct = clipDurationMs > 0 ? (comment.timecode_end_ms / clipDurationMs) * 100 : 0
  const widthPct = Math.max(endPct - startPct, 0)
  const isNarrow = widthPct < 3

  const [showTooltip, setShowTooltip] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleHide = () => { hideTimer.current = setTimeout(() => setShowTooltip(false), 120) }
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  // Visual state:
  //   unchanged            → standard mixer accent overlay
  //   added   & picked     → standard mixer accent overlay (it lands in the target)
  //   added   & skipped    → dashed lime ghost
  //   deleted & picked     → destructive overlay (it will be removed)
  //   deleted & skipped    → standard mixer accent overlay (it stays)
  const isGhost = changeKind === 'added' && !picked
  const isDoomed = changeKind === 'deleted' && picked

  const fillClass = !isGhost && !isDoomed ? 'waveform-accent-fill' : ''
  const edgeClass = !isGhost && !isDoomed ? 'waveform-accent-edge' : ''
  const fillStyle: React.CSSProperties = isDoomed
    ? { background: 'color-mix(in oklab, var(--destructive) 18%, transparent)' }
    : isGhost
      ? { background: 'transparent', border: '1px dashed color-mix(in oklab, var(--lime) 65%, transparent)' }
      : {}
  const edgeStyle: React.CSSProperties = isDoomed ? { background: 'var(--destructive)' } : {}

  const badge = changeKind && (
    <span
      className="text-[8px] font-bold uppercase tracking-widest px-1 py-px shrink-0"
      style={changeKind === 'added'
        ? { background: 'var(--lime)', color: 'var(--primary-foreground)' }
        : { background: 'var(--destructive)', color: '#fff' }}
    >
      {changeKind === 'added' ? 'NEW' : 'DEL'}
    </span>
  )

  const footer = changeKind && (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onToggle() }}
      className="w-full text-[9px] uppercase tracking-widest py-1 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
    >
      {changeKind === 'added'
        ? (picked ? 'Skip this comment' : 'Include this comment')
        : (picked ? 'Keep in target' : 'Apply deletion')}
    </button>
  )

  function getAnchor() {
    const r = rangeRef.current?.getBoundingClientRect()
    if (!r) return { left: 0, top: 0 }
    return isNarrow
      ? { left: r.left, top: r.bottom }
      : { left: r.left + r.width / 2, top: r.bottom }
  }

  return (
    <div
      ref={rangeRef}
      className="absolute top-0 h-full z-[3]"
      data-comment-ui
      style={{
        left: `${startPct}%`,
        width: `${widthPct}%`,
        minWidth: isNarrow ? 20 : 2,
        opacity: isGhost ? 0.55 : 1,
        cursor: changeKind ? 'pointer' : 'default',
      }}
      onMouseEnter={() => { cancelHide(); setShowTooltip(true) }}
      onMouseLeave={scheduleHide}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (changeKind) onToggle() }}
    >
      {/* Range fill — same classes as the mixer's CommentRangeMarker */}
      <div
        className={`absolute inset-0 transition-colors duration-150 ${fillClass}`}
        style={{ opacity: showTooltip ? 1 : 0.55, ...fillStyle }}
      />
      <div
        className={`absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 ${edgeClass}`}
        style={{ left: 0, width: 1.5, opacity: showTooltip ? 1 : 0.5, ...edgeStyle }}
      />
      <div
        className={`absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 ${edgeClass}`}
        style={{ right: 0, width: 1.5, opacity: showTooltip ? 1 : 0.5, ...edgeStyle }}
      />
      {isDoomed && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, color-mix(in oklab, var(--destructive) 25%, transparent) 4px, color-mix(in oklab, var(--destructive) 25%, transparent) 8px)' }}
        />
      )}
      {showTooltip && (() => {
        const { left, top } = getAnchor()
        return (
          <CommentTooltip
            comment={comment}
            anchorLeft={left}
            anchorTop={top}
            onHide={scheduleHide}
            onShow={cancelHide}
            currentUserId={undefined}
            isOwner={false}
            projectOffsetMs={projectOffsetMs}
            readOnly
            statusBadge={badge}
            footer={footer}
          />
        )
      })()}
    </div>
  )
}

// ─── Diff clip (waveform / midi segment on the timeline) ──────────────────────

/** A comment rendered on a clip, annotated with its diff status. */
interface ClipComment {
  comment: TrackComment
  changeKind: CommentChangeKind
}

function commentChangeId(c: ClipComment): ChangeId {
  return `com:${c.changeKind === 'added' ? 'add' : 'del'}:${c.comment.id}`
}

function DiffClip({
  track, color, half, totalMs, contentMs, playing, currentTimeMsRef,
  incoming, dimmed, onClick, clickTitle,
  comments, isCommentPicked, onToggleComment,
  bpm, timeSig, barsVersion,
}: {
  track: Track
  color: string
  /** 'top' | 'bottom' | 'full' — vertical placement inside the row. */
  half: 'top' | 'bottom' | 'full'
  totalMs: number
  contentMs: number
  playing: boolean
  currentTimeMsRef: React.RefObject<number>
  incoming?: boolean
  dimmed?: boolean
  onClick?: () => void
  clickTitle?: string
  comments: ClipComment[]
  isCommentPicked: (id: string) => boolean
  onToggleComment: (id: string) => void
  bpm: number
  timeSig: string
  barsVersion: number
}) {
  const clipRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const offsetMs = barOffsetToMs(Math.max(0, track.start_bar ?? 0), bpm, timeSig)
  const clampedContent = Math.max(1, contentMs)

  // Playhead progress relative to this clip (same approach as compare mode)
  useEffect(() => {
    if (!playing) return
    const tick = () => {
      const el = clipRef.current
      if (!el) return
      const pct = Math.min(100, Math.max(0, ((currentTimeMsRef.current ?? 0) - offsetMs) / clampedContent * 100))
      el.style.setProperty('--played-pct', `${pct}%`)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, offsetMs, clampedContent, currentTimeMsRef])

  useEffect(() => {
    if (playing) return
    const el = clipRef.current
    if (!el) return
    const pct = Math.min(100, Math.max(0, ((currentTimeMsRef.current ?? 0) - offsetMs) / clampedContent * 100))
    el.style.setProperty('--played-pct', `${pct}%`)
  })

  const isMidi = track.file_type === 'midi' && !!track.midi_data
  const leftPct = totalMs > 0 && !isMidi ? Math.max(0, (offsetMs / totalMs) * 100) : 0
  const widthPct = isMidi
    ? 100
    : totalMs > 0
      ? Math.min((clampedContent / totalMs) * 100, 100 - leftPct)
      : 100

  // Clips fill the row — full uses the whole height, split clips take exact halves
  const vertical = half === 'full' ? 'top-0 h-full' : half === 'top' ? 'top-0 h-1/2' : 'bottom-0 h-1/2'

  // barsVersion is a re-render trigger — bars appear once decoding seeds the cache
  void barsVersion
  const bars = waveformBarsCache.get(track.id) ?? []

  return (
    <div
      ref={clipRef}
      className={`absolute ${vertical} ${incoming ? 'ring-1 ring-lime/40' : 'ring-1 ring-border'} ${onClick ? 'cursor-pointer hover:brightness-125' : ''}`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        background: incoming
          ? 'color-mix(in oklab, var(--lime) 7%, transparent)'
          : 'color-mix(in oklab, var(--foreground) 3%, transparent)',
        opacity: dimmed ? 0.4 : 1,
        ...playedPctStyle(0),
      }}
      onClick={onClick}
      title={clickTitle}
    >
      {isMidi && track.midi_data ? (
        <div className="absolute inset-0 flex items-center overflow-hidden">
          <MiniPianoRoll
            midiData={track.midi_data}
            color={color}
            projectBpm={bpm}
            totalProjectMs={totalMs}
            midiStartBar={track.start_bar ?? 0}
            height={28}
          />
        </div>
      ) : bars.length ? (
        <WaveformBarsPlayhead bars={bars} color={color} ready className="h-full" animate={false} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-end pr-2">
          <span className="text-[8px] uppercase tracking-widest text-muted-foreground/40">Loading…</span>
        </div>
      )}

      {/* Comments — mixer-identical markers, positioned track-relative */}
      {comments.map(c => (
        <DiffCommentMarker
          key={c.comment.id}
          comment={c.comment}
          clipDurationMs={isMidi ? Math.max(1, totalMs - offsetMs) : clampedContent}
          changeKind={c.changeKind}
          picked={c.changeKind ? isCommentPicked(commentChangeId(c)) : true}
          onToggle={() => { if (c.changeKind) onToggleComment(commentChangeId(c)) }}
          projectOffsetMs={offsetMs}
        />
      ))}
    </div>
  )
}

// ─── Structure lanes (Target / Incoming / Result) ─────────────────────────────

interface LaneSectionBox {
  key: string
  startBar: number
  endBar: number
  label: string
  /** Extra left padding (px) so the label clears an overlay checkbox. */
  labelPadLeft?: number
}

function sectionsToBoxes(sections: Array<Pick<Section, 'start_bar' | 'end_bar' | 'type' | 'custom_name'>>): LaneSectionBox[] {
  return sections.map((s, i) => ({
    key: `${i}-${s.start_bar}`,
    startBar: s.start_bar,
    endBar: s.end_bar,
    label: barStateLabel({ type: s.type, customName: s.custom_name, chords: null, note: null, color: '' }),
  }))
}

function StructureLane({
  label, boxes, barDurationMs, totalMs, tone, overlays,
}: {
  label: string
  boxes: LaneSectionBox[]
  barDurationMs: number
  totalMs: number
  tone: 'muted' | 'accent' | 'result'
  overlays?: ReactNode
}) {
  const pct = (bar: number) => Math.min(100, (bar * barDurationMs / Math.max(1, totalMs)) * 100)
  return (
    <div className="relative">
      <span
        className="absolute -top-1.5 left-1.5 z-10 px-1 text-[7px] font-bold uppercase tracking-widest bg-background"
        style={{ color: tone === 'muted' ? 'var(--text-muted, var(--muted-foreground))' : 'var(--lime)' }}
      >
        {label}
      </span>
      {/* border-y only — a left/right border would shift the bar→% mapping off the waveform grid */}
      <div
        className={`relative overflow-hidden border-y ${tone === 'result' ? 'border-lime/40' : 'border-border'}`}
        style={{ height: 26, background: tone === 'accent' ? 'color-mix(in oklab, var(--lime) 4%, transparent)' : 'var(--bg-surface, transparent)' }}
      >
        {boxes.map(b => (
          <div
            key={b.key}
            className="absolute inset-y-0 flex items-center overflow-hidden"
            style={{
              left: `${pct(b.startBar)}%`,
              width: `${Math.max(0, pct(b.endBar) - pct(b.startBar))}%`,
              paddingLeft: 6 + (b.labelPadLeft ?? 0),
              paddingRight: 6,
              // Full-bleed fill; adjacent sections divided by a between-border
              borderLeft: b.startBar > 0 ? '1px solid var(--border)' : undefined,
              background: tone === 'muted'
                ? 'color-mix(in oklab, var(--foreground) 5%, transparent)'
                : 'var(--lime-soft)',
            }}
          >
            <span
              className="text-[8px] uppercase tracking-widest font-bold whitespace-nowrap overflow-hidden text-ellipsis"
              style={{ color: tone === 'muted' ? 'var(--muted-foreground)' : 'var(--lime)' }}
            >
              {b.label}
            </span>
          </div>
        ))}
        {overlays}
      </div>
    </div>
  )
}

// ─── Transport bar ────────────────────────────────────────────────────────────

function DiffTransportBar({
  playing, currentTimeMs, duration, onPlay, onPause, onSeek,
  abMode, onAbMode, targetName, loaded, total,
}: {
  playing: boolean
  currentTimeMs: number
  duration: number
  onPlay: () => void
  onPause: () => void
  onSeek: (ms: number) => void
  abMode: ABMode
  onAbMode: (m: ABMode) => void
  targetName: string
  loaded: number
  total: number
}) {
  const seekRef = useRef<HTMLDivElement>(null)
  const pct = duration > 0 ? Math.min(100, (currentTimeMs / duration) * 100) : 0

  function handleSeekClick(e: React.MouseEvent) {
    const rect = seekRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration)
  }

  return (
    <div className="border-t border-border bg-background flex items-center gap-3 px-4 py-2 shrink-0">
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        className="size-7 border border-border text-foreground hover:border-lime hover:text-lime transition grid place-items-center shrink-0"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1.5" y="1.5" width="2.5" height="7" />
            <rect x="6" y="1.5" width="2.5" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5l7 3.5-7 3.5z" />
          </svg>
        )}
      </button>

      <span className="text-[10px] tabular-nums font-mono text-muted-foreground w-12 shrink-0">
        {fmtTime(currentTimeMs / 1000)}
      </span>

      <div ref={seekRef} onClick={handleSeekClick} className="flex-1 h-1 bg-border relative cursor-pointer group">
        <div className="absolute left-0 top-0 h-full bg-lime" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-foreground border border-background opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${pct}%` }}
        />
      </div>

      <span className="text-[10px] tabular-nums font-mono text-muted-foreground w-12 shrink-0 text-right">
        {fmtTime(duration / 1000)}
      </span>

      {/* Listen toggle: current target vs. cherry-picked result */}
      <div className="flex border border-border shrink-0">
        {([['a', targetName], ['b', 'Result preview']] as const).map(([mode, label], i) => {
          const active = abMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onAbMode(mode)}
              className={`text-[9px] uppercase tracking-widest px-2.5 py-1 transition truncate max-w-[140px] ${
                i === 0 ? 'border-r border-border' : ''
              } ${active ? 'bg-lime text-primary-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0 hidden lg:inline">
        {loaded < total ? `loading ${loaded}/${total}` : abMode === 'a' ? 'Listening: current' : 'Listening: result'}
      </span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CherryPickDiff({
  project,
  versions,
  branchId,
  targetVersionId,
  onExit,
  onApplied,
}: {
  project: Project
  versions: Version[]
  branchId: string
  targetVersionId: string
  onExit: () => void
  onApplied: (result: { tracksUpdated: number; branchName: string; targetName: string }) => void
}) {
  const { preview, loading: previewLoading, error: previewError } = useMergePreview(project.id, branchId, targetVersionId)

  const targetVersion = versions.find(v => v.id === targetVersionId)
  const branchVersion = versions.find(v => v.id === branchId)
  const targetTracks = useMemo(() => targetVersion?.tracks ?? [], [targetVersion])
  const branchTracks = useMemo(() => branchVersion?.tracks ?? [], [branchVersion])

  const bpm = project.bpm ?? 120
  const timeSig = project.time_signature ?? '4/4'
  const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar

  // ── Sections for both versions ─────────────────────────────────────────────
  const [targetSections, setTargetSections] = useState<Section[]>([])
  const [branchSections, setBranchSections] = useState<Section[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/versions/${targetVersionId}/sections`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setTargetSections(d.sections ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [targetVersionId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/versions/${branchId}/sections`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setBranchSections(d.sections ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [branchId])

  // ── Change model ───────────────────────────────────────────────────────────
  const trackChanges = useMemo(() => preview ? buildTrackChanges(preview) : new Map<string, TrackChangeInfo>(), [preview])
  const autoTrackChanges = useMemo(() => [...trackChanges.values()].filter(c => c.auto), [trackChanges])
  const conflictTrackChanges = useMemo(() => [...trackChanges.values()].filter(c => c.conflict), [trackChanges])
  /** Tracks only in the target — kept by default, removable per-track (opt-in). */
  const targetOnlyTracks = useMemo(() => preview?.targetOnlyTracks ?? [], [preview])

  const sectionAuto: AutoBarRange[] = useMemo(() => preview?.sectionAutoFromBranch ?? [], [preview])
  const sectionConflicts: ConflictRange[] = useMemo(() => preview?.sectionBarConflicts ?? [], [preview])

  const addedComments = useMemo(() => preview?.commentChanges?.added ?? [], [preview])
  const deletedComments = useMemo(() => preview?.commentChanges?.deleted ?? [], [preview])
  const addedCommentIds = useMemo(() => new Set(addedComments.map(c => c.id)), [addedComments])
  const deletedCommentIds = useMemo(() => new Set(deletedComments.map(c => c.id)), [deletedComments])

  const trackChangeIds = useMemo(() => autoTrackChanges.map(c => `track:${c.trackName}`), [autoTrackChanges])
  const sectionChangeIds = useMemo(() => sectionAuto.map(rangeId), [sectionAuto])
  const commentChangeIds = useMemo(() => [
    ...addedComments.map(c => `com:add:${c.id}`),
    ...deletedComments.map(c => `com:del:${c.id}`),
  ], [addedComments, deletedComments])
  // NOTE: trackdel:<name> removal ids are deliberately NOT part of this list —
  // "Select all" and group toggles must never turn destructive removals on.
  const allPickableIds = useMemo(
    () => [...trackChangeIds, ...sectionChangeIds, ...commentChangeIds],
    [trackChangeIds, sectionChangeIds, commentChangeIds],
  )

  // ── Pick state — everything selected by default ────────────────────────────
  const [picked, setPicked] = useState<Set<ChangeId>>(new Set())
  // Conflicts default to the FIRST of the two options (target / "Keep master").
  const [trackChoices, setTrackChoices] = useState<Record<string, MergeResolution>>({})
  const [sectionChoices, setSectionChoices] = useState<Record<string, 'main' | 'branch'>>({})

  useEffect(() => {
    if (!preview) return
    setPicked(new Set(allPickableIds))
    const tc: Record<string, MergeResolution> = {}
    for (const c of preview.conflicts) {
      tc[c.trackName] = {
        ...(c.fileConflict && { fileChoice: 'main' as const }),
        ...(c.renameConflict && { nameChoice: 'main' as const }),
        ...(c.offsetConflict && { offsetChoice: 'main' as const }),
      }
    }
    setTrackChoices(tc)
    const sc: Record<string, 'main' | 'branch'> = {}
    for (const c of preview.sectionBarConflicts ?? []) sc[rangeKey(c)] = 'main'
    setSectionChoices(sc)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  const isPicked = useCallback((id: ChangeId) => picked.has(id), [picked])
  const togglePick = useCallback((id: ChangeId) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const setGroup = useCallback((ids: ChangeId[], on: boolean) => {
    setPicked(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
  }, [])

  // ── Result track set (feeds the audio engine + result lane) ────────────────
  const resultTracks = useMemo<Track[]>(() => {
    const branchByName = new Map(branchTracks.map(t => [t.name, t]))
    const out: Track[] = []

    for (const mt of targetTracks) {
      const bt = branchByName.get(mt.name)
      const change = trackChanges.get(mt.name)
      // Target-only track with removal opted in — excluded from the result
      if (!bt && isPicked(`trackdel:${mt.name}`)) continue
      if (!bt || !change) { out.push(mt); continue }

      if (change.conflict) {
        const res = trackChoices[mt.name] ?? {}
        const fileTrack = change.conflict.fileConflict && res.fileChoice === 'branch' ? bt : mt
        const displayName = change.conflict.renameConflict
          ? (res.nameChoice === 'branch' ? bt.display_name : mt.display_name)
          : (fileTrack.display_name ?? mt.display_name)
        const startBar = change.conflict.offsetConflict
          ? (res.offsetChoice === 'branch' ? bt.start_bar : mt.start_bar)
          : fileTrack.start_bar
        out.push({ ...fileTrack, display_name: displayName ?? null, start_bar: startBar, midi_start_bar: startBar })
        continue
      }

      // Auto change — applied only when picked
      if (!isPicked(`track:${mt.name}`)) { out.push(mt); continue }
      const fileTrack = change.fileFromBranch ? bt : mt
      out.push({
        ...fileTrack,
        display_name: change.newDisplayName ?? fileTrack.display_name,
        start_bar: change.newStartBar ?? fileTrack.start_bar,
        midi_start_bar: change.newStartBar ?? fileTrack.start_bar,
      })
    }

    // Tracks that only exist in the version (new tracks)
    for (const bt of branchTracks) {
      if (targetTracks.some(t => t.name === bt.name)) continue
      const change = trackChanges.get(bt.name)
      if (change?.auto && change.isNew) {
        if (isPicked(`track:${bt.name}`)) out.push(bt)
      }
    }

    return out
  }, [targetTracks, branchTracks, trackChanges, trackChoices, isPicked])

  // ── Audio: A = current target, B = cherry-picked result (reused engine) ─────
  // The B side also carries branch tracks that aren't part of the current result
  // (muted) so every incoming clip gets decoded and its waveform bars seeded.
  const resultTrackIdsKey = resultTracks.map(t => t.id).join('|')
  const audioTracksB = useMemo(() => {
    const resultIds = new Set(resultTracks.map(t => t.id))
    return [...resultTracks, ...branchTracks.filter(t => !resultIds.has(t.id))]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultTrackIdsKey, branchTracks])

  const audio = useCompareAudio(targetTracks, audioTracksB, project)

  // Keep non-result tracks silent on the B side — they're only there for decoding
  const muteTrack = audio.muteTrack
  useEffect(() => {
    const resultIds = new Set(resultTracks.map(t => t.id))
    for (const t of audioTracksB) muteTrack('b', t.id, !resultIds.has(t.id))
  }, [audioTracksB, resultTracks, muteTrack])

  // Default to listening to the result preview
  const defaultedAb = useRef(false)
  useEffect(() => {
    if (defaultedAb.current) return
    defaultedAb.current = true
    audio.setAbMode('b')
  }, [audio])

  // Spacebar play/pause while the diff view is active
  const audioRef = useRef(audio)
  useEffect(() => { audioRef.current = audio })
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') { onExit(); return }
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      if (audioRef.current.playing) audioRef.current.pause()
      else audioRef.current.play()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onExit])

  // Waveform bars land in the shared cache as the engine decodes each buffer;
  // the resolved-duration state updates it triggers re-render the clips.
  const barsVersion = audio.loadedA + audio.loadedB

  // ── Structure maps ─────────────────────────────────────────────────────────
  const totalBars = useMemo(() => calculateTotalBars(targetSections, branchSections), [targetSections, branchSections])
  const targetMap = useMemo(() => buildBarMap(targetSections, totalBars), [targetSections, totalBars])
  const branchMap = useMemo(() => buildBarMap(branchSections, totalBars), [branchSections, totalBars])

  const resultSections = useMemo(() => {
    const map = [...targetMap]
    for (const r of sectionAuto) {
      if (!isPicked(rangeId(r))) continue
      for (let b = r.startBar; b < r.endBar && b < map.length; b++) map[b] = branchMap[b]
    }
    for (const c of sectionConflicts) {
      const choice = sectionChoices[rangeKey(c)] ?? 'main'
      const state = choice === 'branch' ? c.branchState : c.mainState
      for (let b = c.startBar; b < c.endBar && b < map.length; b++) map[b] = state
    }
    return barMapToSections(map, 'result', project.id)
  }, [targetMap, branchMap, sectionAuto, sectionConflicts, sectionChoices, isPicked, project.id])

  // ── Timeline length ────────────────────────────────────────────────────────
  const totalMs = Math.max(audio.duration, totalBars * barDurationMs, 1)

  // ── Diff rows (target order first, then version-only tracks) ───────────────
  const rows = useMemo(() => {
    const branchByName = new Map(branchTracks.map(t => [t.name, t]))
    const list: Array<{ name: string; target: Track | null; branch: Track | null; change: TrackChangeInfo | null }> = []
    for (const mt of targetTracks) {
      list.push({ name: mt.name, target: mt, branch: branchByName.get(mt.name) ?? null, change: trackChanges.get(mt.name) ?? null })
    }
    for (const bt of branchTracks) {
      if (targetTracks.some(t => t.name === bt.name)) continue
      list.push({ name: bt.name, target: null, branch: bt, change: trackChanges.get(bt.name) ?? null })
    }
    return list
  }, [targetTracks, branchTracks, trackChanges])

  // ── Apply ──────────────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState('')

  const pickedCount = allPickableIds.filter(id => picked.has(id)).length
  const totalCount = allPickableIds.length
  const conflictCount = conflictTrackChanges.length + sectionConflicts.length
  const removedCount = targetOnlyTracks.filter(t => picked.has(`trackdel:${t.name}`)).length
  const nothingToApply = pickedCount === 0 && conflictCount === 0 && removedCount === 0

  async function handleApply() {
    if (!preview || applying || nothingToApply) return
    setApplying(true)
    setApplyErr('')
    try {
      const skippedTracks = autoTrackChanges.filter(c => !picked.has(`track:${c.trackName}`)).map(c => c.trackName)
      const removedTracks = targetOnlyTracks.filter(t => picked.has(`trackdel:${t.name}`)).map(t => t.name)
      const skippedSections = sectionAuto
        .filter(r => !picked.has(rangeId(r)))
        .map(r => ({ startBar: r.startBar, endBar: r.endBar }))
      const skippedAddedCommentIds = addedComments.filter(c => !picked.has(`com:add:${c.id}`)).map(c => c.id)
      const appliedDeletedCommentIds = deletedComments.filter(c => picked.has(`com:del:${c.id}`)).map(c => c.id)

      const res = await fetch(`/api/projects/${project.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchVersionId: preview.branchVersionId,
          target_version_id: preview.targetVersionId,
          skippedTracks,
          removedTracks,
          skippedSections,
          skippedAddedCommentIds,
          appliedDeletedCommentIds,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setApplyErr(e.error ?? 'Apply failed')
        return
      }
      const data = await res.json()
      trackEvent('merge_completed', {
        had_conflicts: conflictCount > 0,
        cherry_picked: pickedCount < totalCount,
      })
      onApplied({
        tracksUpdated: data.tracks_updated ?? 0,
        branchName: preview.branchName,
        targetName: preview.targetVersionName,
      })
    } catch {
      setApplyErr('Network error')
    } finally {
      setApplying(false)
    }
  }

  const branchName = preview?.branchName ?? (branchVersion?.name ?? 'version')
  const targetName = preview?.targetVersionName ?? (targetVersion?.name ?? 'target')

  // ── Group expand state ─────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ tracks: true, structure: true, comments: true })
  const toggleGroup = (k: string) => setExpanded(e => ({ ...e, [k]: !e[k] }))

  const allOn = (ids: string[]) => ids.length > 0 && ids.every(i => picked.has(i))
  const anyOn = (ids: string[]) => ids.some(i => picked.has(i))

  // ─── Render ────────────────────────────────────────────────────────────────

  if (previewError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="border border-border p-6 max-w-sm text-center">
          <p className="text-xs text-destructive m-0 mb-4">{previewError}</p>
          <button
            type="button"
            onClick={onExit}
            className="text-[10px] uppercase tracking-widest px-4 py-2 border border-border text-muted-foreground hover:border-lime hover:text-lime transition"
          >
            ← Back to mixer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-background">

      {/* ── Left: changes list (replaces the versions/resources toolbar) ── */}
      <aside className="w-[240px] shrink-0 flex flex-col h-full overflow-hidden border-r border-border bg-surface/30">
        <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
          <SectionLabel>{'// Cherry-pick apply'}</SectionLabel>
          <div className="mt-2 text-[13px] font-display font-bold uppercase tracking-tight text-foreground truncate" title={branchName}>
            {branchName}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-0.5 truncate">
            → {targetName}
          </div>
          {totalCount > 0 && (
            <button
              type="button"
              onClick={() => setGroup(allPickableIds, !allOn(allPickableIds))}
              className="mt-3 w-full flex items-center justify-between border border-border px-2 py-1.5 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
            >
              <span>{allOn(allPickableIds) ? 'Deselect all' : 'Select all'}</span>
              <span className="font-mono text-lime tabular-nums">{pickedCount}/{totalCount}</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-none min-h-0">
          {previewLoading || !preview ? (
            <div className="px-4"><MergePreviewLoading label="Computing differences…" /></div>
          ) : (
            <>
              <ChangeGroup
                label="Tracks"
                count={autoTrackChanges.length + conflictTrackChanges.length}
                allOn={allOn(trackChangeIds)}
                anyOn={anyOn(trackChangeIds)}
                onToggleAll={() => setGroup(trackChangeIds, !allOn(trackChangeIds))}
                open={expanded.tracks}
                onToggle={() => toggleGroup('tracks')}
              >
                {conflictTrackChanges.map(c => {
                  const conflict = c.conflict!
                  const res = trackChoices[c.trackName] ?? {}
                  return (
                    <ConflictRow key={c.trackName} title={trackTitle(conflict.branchTrack)} resolvedBadge="Overlap">
                      {conflict.fileConflict && (
                        <ChoicePair
                          label="File"
                          mainLabel="Target"
                          branchLabel="Version"
                          choice={res.fileChoice ?? 'main'}
                          onChoose={choice => setTrackChoices(r => ({ ...r, [c.trackName]: { ...r[c.trackName], fileChoice: choice } }))}
                        />
                      )}
                      {conflict.renameConflict && (
                        <ChoicePair
                          label="Name"
                          mainLabel={trackTitle(conflict.mainTrack)}
                          branchLabel={trackTitle(conflict.branchTrack)}
                          choice={res.nameChoice ?? 'main'}
                          onChoose={choice => setTrackChoices(r => ({ ...r, [c.trackName]: { ...r[c.trackName], nameChoice: choice } }))}
                        />
                      )}
                      {conflict.offsetConflict && (
                        <ChoicePair
                          label="Start"
                          mainLabel={formatTrackStartBar(conflict.mainTrack.start_bar)}
                          branchLabel={formatTrackStartBar(conflict.branchTrack.start_bar)}
                          choice={res.offsetChoice ?? 'main'}
                          onChoose={choice => setTrackChoices(r => ({ ...r, [c.trackName]: { ...r[c.trackName], offsetChoice: choice } }))}
                        />
                      )}
                    </ConflictRow>
                  )
                })}
                {autoTrackChanges.map(c => {
                  const id = `track:${c.trackName}`
                  const branchTrack = branchTracks.find(t => t.name === c.trackName)
                  return (
                    <PickRow
                      key={id}
                      on={picked.has(id)}
                      onToggle={() => togglePick(id)}
                      sign={c.isNew ? '+' : '~'}
                      title={branchTrack ? trackTitle(branchTrack) : c.trackName}
                      detail={c.notes.join(' · ')}
                      warn={c.targetNewer}
                    />
                  )
                })}
                {/* Target-only tracks — kept by default; removal is a per-track opt-in
                    and is never included in select-all */}
                {targetOnlyTracks.map(t => {
                  const id = `trackdel:${t.name}`
                  const on = picked.has(id)
                  return (
                    <PickRow
                      key={id}
                      on={on}
                      onToggle={() => togglePick(id)}
                      sign="−"
                      removed
                      title={trackTitle(t)}
                      detail={on
                        ? 'will be REMOVED from the target'
                        : `not in this version — kept in ${targetName}`}
                    />
                  )
                })}
                {autoTrackChanges.length + conflictTrackChanges.length + targetOnlyTracks.length === 0 && (
                  <p className="px-3 py-1 text-[9px] text-muted-foreground m-0">No track changes</p>
                )}
              </ChangeGroup>

              <ChangeGroup
                label="Structure"
                count={sectionAuto.length + sectionConflicts.length}
                allOn={allOn(sectionChangeIds)}
                anyOn={anyOn(sectionChangeIds)}
                onToggleAll={() => setGroup(sectionChangeIds, !allOn(sectionChangeIds))}
                open={expanded.structure}
                onToggle={() => toggleGroup('structure')}
              >
                {sectionConflicts.map(c => (
                  <ConflictRow key={rangeKey(c)} title={`Bars ${c.startBar + 1}–${c.endBar}`} resolvedBadge="Overlap">
                    <ChoicePair
                      label="Keep"
                      mainLabel={barStateLabel(c.mainState)}
                      branchLabel={barStateLabel(c.branchState)}
                      choice={sectionChoices[rangeKey(c)] ?? 'main'}
                      onChoose={choice => setSectionChoices(r => ({ ...r, [rangeKey(c)]: choice }))}
                    />
                  </ConflictRow>
                ))}
                {sectionAuto.map(r => {
                  const id = rangeId(r)
                  const kind = classifySectionRange(r, targetMap, r.branchState)
                  return (
                    <PickRow
                      key={id}
                      on={picked.has(id)}
                      onToggle={() => togglePick(id)}
                      sign={kind === 'added' ? '+' : kind === 'removed' ? '−' : '~'}
                      removed={kind === 'removed'}
                      title={`Bars ${r.startBar + 1}–${r.endBar}`}
                      detail={r.branchState ? `→ ${barStateLabel(r.branchState)}` : 'cleared'}
                      warn={r.targetNewer}
                    />
                  )
                })}
                {sectionAuto.length + sectionConflicts.length === 0 && (
                  <p className="px-3 py-1 text-[9px] text-muted-foreground m-0">No structure changes</p>
                )}
              </ChangeGroup>

              <ChangeGroup
                label="Comments"
                count={commentChangeIds.length}
                allOn={allOn(commentChangeIds)}
                anyOn={anyOn(commentChangeIds)}
                onToggleAll={() => setGroup(commentChangeIds, !allOn(commentChangeIds))}
                open={expanded.comments}
                onToggle={() => toggleGroup('comments')}
              >
                {addedComments.map(c => (
                  <PickRow
                    key={`com:add:${c.id}`}
                    on={picked.has(`com:add:${c.id}`)}
                    onToggle={() => togglePick(`com:add:${c.id}`)}
                    sign="+"
                    title={`@${c.author_username ?? 'unknown'} · ${c.track_name}`}
                    detail={c.content}
                  />
                ))}
                {deletedComments.map(c => (
                  <PickRow
                    key={`com:del:${c.id}`}
                    on={picked.has(`com:del:${c.id}`)}
                    onToggle={() => togglePick(`com:del:${c.id}`)}
                    sign="−"
                    removed
                    title={`@${c.author_username ?? 'unknown'} · ${c.track_name}`}
                    detail={c.content}
                  />
                ))}
                {commentChangeIds.length === 0 && (
                  <p className="px-3 py-1 text-[9px] text-muted-foreground m-0">No comment changes</p>
                )}
              </ChangeGroup>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3 space-y-2">
          <DiffLegend />
          {applyErr && <p className="text-[10px] text-destructive m-0">{applyErr}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onExit}
              className="py-2 inline-flex items-center justify-center whitespace-nowrap border border-border text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:border-foreground/40 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={applying || previewLoading || !preview || nothingToApply}
              onClick={handleApply}
              className="py-2 inline-flex items-center justify-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-widest font-bold bg-lime text-primary-foreground border border-lime transition hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
            >
              {applying ? 'Applying…' : <>Apply {pickedCount + conflictCount + removedCount} <span aria-hidden>→</span></>}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Center: diff timeline ── */}
      <main className="flex flex-col flex-1 overflow-hidden min-w-0">

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 border-b border-border bg-surface/40 shrink-0 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-widest font-bold text-lime shrink-0">
              {'// Diff · click any change to include or skip'}
            </span>
            <span className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 border border-lime/60 bg-lime-soft text-lime text-[10px] uppercase tracking-widest truncate max-w-[180px]">
                ⎇ {branchName}
              </span>
              <span className="text-muted-foreground text-[11px]">→</span>
              <span className="px-2 py-0.5 border border-border bg-surface/40 text-foreground text-[10px] uppercase tracking-widest truncate max-w-[180px]">
                ● {targetName}
              </span>
            </span>
          </div>
          {totalCount > 0 && (
            <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-widest">
              <span className="text-lime font-mono tabular-nums">{pickedCount}</span>
              <span className="text-muted-foreground">of {totalCount} changes selected</span>
              <div className="w-32 h-1 bg-border relative overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-lime transition-all duration-300"
                  style={{ width: `${(pickedCount / Math.max(1, totalCount)) * 100}%` }}
                />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onExit}
            className="ml-auto shrink-0 bg-lime text-primary-foreground text-[9px] uppercase tracking-widest px-3 py-1.5 border border-lime hover:opacity-90 transition font-bold"
          >
            ← Exit diff
          </button>
        </div>

        {/* Scrollable diff body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none">

          {/* Bar ruler — 2px transparent borderLeft mirrors the track rows' status border so all rows share one grid */}
          <div className="flex border-b border-border" style={{ height: 24, borderLeft: '2px solid transparent' }}>
            <div className="shrink-0 border-r border-border bg-surface/40 flex items-center px-3" style={{ width: LABEL_W }}>
              <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground">
                Bars · {timeSig}
              </span>
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <BarRuler
                totalDurationMs={totalMs}
                barDurationMs={barDurationMs}
                currentTimeMsRef={audio.currentTimeMsRef}
                playing={audio.playing}
                onSeek={audio.seek}
              />
            </div>
          </div>

          {/* Structure: Target / Incoming / Result lanes — same 2px inset as track rows */}
          <div className="flex border-b border-border" style={{ borderLeft: '2px solid transparent' }}>
            <div className="shrink-0 border-r border-border px-3 py-3 flex flex-col gap-1.5 bg-lime-soft/40" style={{ width: LABEL_W }}>
              <span className="text-[9px] uppercase tracking-widest font-bold text-lime">Structure</span>
              <span className="text-[8px] uppercase tracking-widest text-muted-foreground leading-relaxed">
                Both arrangements overlapped — result updates live
              </span>
            </div>
            {/* No horizontal padding — lanes share the exact coordinate system of the waveform rows */}
            <div className="flex-1 min-w-0 pt-3 pb-2 flex flex-col gap-3">
              <StructureLane
                label="Target"
                tone="muted"
                boxes={sectionsToBoxes(targetSections)}
                barDurationMs={barDurationMs}
                totalMs={totalMs}
                overlays={sectionAuto.filter(r => classifySectionRange(r, targetMap, r.branchState) === 'removed').map(r => (
                  <div
                    key={rangeKey(r)}
                    className="absolute inset-y-0 pointer-events-none border border-destructive/60"
                    style={{
                      left: `${(r.startBar * barDurationMs / totalMs) * 100}%`,
                      width: `${((r.endBar - r.startBar) * barDurationMs / totalMs) * 100}%`,
                      background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, color-mix(in oklab, var(--destructive) 12%, transparent) 4px, color-mix(in oklab, var(--destructive) 12%, transparent) 8px)',
                    }}
                  />
                ))}
              />
              <StructureLane
                label="Incoming"
                tone="accent"
                boxes={sectionsToBoxes(branchSections)}
                barDurationMs={barDurationMs}
                totalMs={totalMs}
                overlays={[...sectionAuto, ...sectionConflicts].map(r => {
                  const isConflict = sectionConflicts.some(c => c.startBar === r.startBar && c.endBar === r.endBar)
                  const kind = isConflict ? null : classifySectionRange(r, targetMap, (r as AutoBarRange).branchState)
                  return (
                    <div
                      key={`in-${rangeKey(r)}`}
                      className="absolute inset-y-0 pointer-events-none border border-lime/70 flex items-start justify-end"
                      style={{
                        left: `${(r.startBar * barDurationMs / totalMs) * 100}%`,
                        width: `${((r.endBar - r.startBar) * barDurationMs / totalMs) * 100}%`,
                      }}
                    >
                      <span className="text-[7px] font-mono font-bold uppercase tracking-widest px-1 bg-lime text-primary-foreground">
                        {isConflict ? '!' : kind === 'added' ? 'NEW' : kind === 'removed' ? 'DEL' : 'MOD'}
                      </span>
                    </div>
                  )
                })}
              />
              <StructureLane
                label="Result"
                tone="result"
                boxes={sectionsToBoxes(resultSections).map(b =>
                  // Overlay checkboxes sit at the start of each pickable range —
                  // shift the label right so it isn't covered.
                  sectionAuto.some(r => r.startBar === b.startBar) ? { ...b, labelPadLeft: 18 } : b,
                )}
                barDurationMs={barDurationMs}
                totalMs={totalMs}
                overlays={
                  <>
                    {sectionAuto.map(r => {
                      const id = rangeId(r)
                      const on = picked.has(id)
                      return (
                        <button
                          key={`res-${rangeKey(r)}`}
                          type="button"
                          onClick={() => togglePick(id)}
                          title={on ? 'Click to skip this change' : 'Click to include this change'}
                          className="absolute inset-y-0 flex items-center gap-1 px-1 cursor-pointer hover:brightness-125 overflow-hidden"
                          style={{
                            left: `${(r.startBar * barDurationMs / totalMs) * 100}%`,
                            width: `${((r.endBar - r.startBar) * barDurationMs / totalMs) * 100}%`,
                            border: on ? '1px solid var(--lime)' : '1px dashed var(--border)',
                            background: on ? 'transparent' : 'color-mix(in oklab, var(--background) 55%, transparent)',
                          }}
                        >
                          <PickCheckbox on={on} onClick={() => togglePick(id)} size={10} />
                          {!on && <span className="text-[7px] uppercase tracking-widest text-muted-foreground">skipped</span>}
                        </button>
                      )
                    })}
                    {sectionConflicts.map(c => {
                      const key = rangeKey(c)
                      const choice = sectionChoices[key] ?? 'main'
                      return (
                        <button
                          key={`resc-${key}`}
                          type="button"
                          onClick={() => setSectionChoices(r => ({ ...r, [key]: choice === 'main' ? 'branch' : 'main' }))}
                          title={`Overlap — currently keeping ${choice === 'main' ? 'target' : 'version'}. Click to switch.`}
                          className="absolute inset-y-0 flex items-center justify-end px-1 cursor-pointer hover:brightness-125 overflow-hidden border border-destructive/70"
                          style={{
                            left: `${(c.startBar * barDurationMs / totalMs) * 100}%`,
                            width: `${((c.endBar - c.startBar) * barDurationMs / totalMs) * 100}%`,
                          }}
                        >
                          <span className="text-[7px] font-mono font-bold uppercase tracking-widest px-1 bg-destructive text-white">
                            {choice === 'main' ? 'TARGET' : 'VERSION'}
                          </span>
                        </button>
                      )
                    })}
                  </>
                }
              />
            </div>
          </div>

          {/* Track diff rows */}
          {rows.map((row, i) => {
            const change = row.change
            const conflict = change?.conflict
            const isAuto = !!change?.auto
            const id = `track:${row.name}`
            const on = conflict ? true : isAuto ? picked.has(id) : true
            const isSame = !change
            const isNew = !!change?.isNew
            // Target-only track: kept by default, removable via opt-in checkbox
            const isTargetOnly = !!row.target && !row.branch && !change
            const removalId = `trackdel:${row.name}`
            const removalOn = isTargetOnly && picked.has(removalId)
            const displayTrack = row.branch ?? row.target!
            const accent = trackAccentColor(displayTrack.icon_color ?? null, i)

            const fileChoiceBranch = conflict ? (trackChoices[row.name]?.fileChoice ?? 'main') === 'branch' : false
            const showIncoming = !!row.branch && !isSame && (conflict ? conflict.fileConflict : (on && (change?.fileFromBranch ?? false)))
            const showTarget = !!row.target

            const badge = isSame
              ? null
              : conflict
                ? { label: '! OVERLAP', style: { background: 'var(--destructive)', color: '#fff' } }
                : isNew
                  ? { label: '+ NEW TRACK', style: { background: 'var(--lime)', color: 'var(--primary-foreground)' } }
                  : { label: '~ CHANGED', style: { background: 'var(--foreground)', color: 'var(--background)' } }

            const targetDurMs = row.target
              ? (audio.resolvedDurationsA.get(row.target.id)
                ?? row.target.duration_ms
                ?? Math.max(1, totalMs - barOffsetToMs(Math.max(0, row.target.start_bar ?? 0), bpm, timeSig)))
              : 0
            const branchDurMs = row.branch
              ? (audio.resolvedDurationsB.get(row.branch.id)
                ?? row.branch.duration_ms
                ?? Math.max(1, totalMs - barOffsetToMs(Math.max(0, row.branch.start_bar ?? 0), bpm, timeSig)))
              : 0

            // Comments per clip. When the incoming clip is hidden (unchanged
            // audio, skipped change, …) the version's ADDED comments are shown
            // on the target clip so every comment change stays visible.
            const branchClipComments: ClipComment[] = (row.branch?.comments ?? []).map(c => ({
              comment: c,
              changeKind: addedCommentIds.has(c.id) ? 'added' as const : null,
            }))
            const targetClipComments: ClipComment[] = [
              ...(row.target?.comments ?? []).map(c => ({
                comment: c,
                changeKind: deletedCommentIds.has(c.id) ? 'deleted' as const : null,
              })),
              ...(!showIncoming
                ? branchClipComments.filter(c => c.changeKind === 'added')
                : []),
            ]

            return (
              <div
                key={row.name}
                className={`flex border-b border-border relative ${isSame && !removalOn ? 'opacity-60' : ''} ${on && isNew ? 'bg-lime-soft/20' : ''}`}
                style={{ borderLeft: `2px solid ${removalOn ? 'var(--destructive)' : !isSame && on ? (conflict ? 'var(--destructive)' : isNew ? 'var(--lime)' : 'color-mix(in oklab, var(--foreground) 35%, transparent)') : 'transparent'}` }}
              >
                {/* Label column */}
                <div className="shrink-0 border-r border-border px-3 py-2.5 flex flex-col gap-1.5 bg-surface/40" style={{ width: LABEL_W }}>
                  <div className="flex items-center gap-2 min-w-0">
                    {isAuto && <PickCheckbox on={on} onClick={() => togglePick(id)} />}
                    {isTargetOnly && <PickCheckbox on={removalOn} removed onClick={() => togglePick(removalId)} />}
                    {/* Track badge — first letter, mixer-identical */}
                    <div
                      className="size-5 grid place-items-center text-[10px] font-bold text-white uppercase shrink-0"
                      style={{ background: accent }}
                    >
                      {(trackTitle(displayTrack).trim()[0] ?? '?').toUpperCase()}
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-tight truncate text-foreground" title={trackTitle(displayTrack)}>
                      {trackTitle(displayTrack)}
                    </span>
                    {displayTrack.file_type === 'midi' && (
                      <span className="ml-auto text-[8px] uppercase tracking-widest text-muted-foreground border border-border px-1 py-px shrink-0">MIDI</span>
                    )}
                  </div>
                  {badge && (
                    <span
                      className="w-fit font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5"
                      style={on ? badge.style : { border: '1px dashed var(--border)', color: 'var(--muted-foreground)' }}
                    >
                      {on ? badge.label : 'SKIPPED'}
                    </span>
                  )}
                  {change && !conflict && change.notes.length > 0 && (
                    <span className={`text-[8px] uppercase tracking-widest leading-tight ${on ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                      {change.notes.join(' · ')}
                    </span>
                  )}
                  {change?.targetNewer && on && <span className="w-fit"><TargetNewerChip /></span>}
                  {conflict && (
                    <span className="text-[8px] uppercase tracking-widest leading-tight text-muted-foreground">
                      {change!.notes[0]} — using {fileChoiceBranch ? 'version' : 'target'}
                    </span>
                  )}
                  {isTargetOnly && (
                    <span className={`text-[8px] uppercase tracking-widest leading-tight ${removalOn ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {removalOn ? 'will be removed from target' : 'not in version — kept'}
                    </span>
                  )}
                  {isSame && !isTargetOnly && <span className="text-[8px] uppercase tracking-widest text-muted-foreground">unchanged</span>}
                </div>

                {/* Timeline canvas */}
                <div className="relative flex-1 min-w-0" style={{ height: 70 }}>
                  {showTarget && row.target && (
                    <DiffClip
                      track={row.target}
                      color={isSame ? accent : fileChoiceBranch || (on && showIncoming) ? MONO_CLIP_COLOR : accent}
                      half={showIncoming ? 'top' : 'full'}
                      totalMs={totalMs}
                      contentMs={targetDurMs}
                      playing={audio.playing}
                      currentTimeMsRef={audio.currentTimeMsRef}
                      dimmed={conflict ? conflict.fileConflict && fileChoiceBranch : false}
                      onClick={conflict?.fileConflict
                        ? () => setTrackChoices(r => ({ ...r, [row.name]: { ...r[row.name], fileChoice: 'main' } }))
                        : undefined}
                      clickTitle={conflict?.fileConflict ? 'Keep the target audio' : undefined}
                      comments={targetClipComments}
                      isCommentPicked={isPicked}
                      onToggleComment={togglePick}
                      bpm={bpm}
                      timeSig={timeSig}
                      barsVersion={barsVersion}
                    />
                  )}
                  {showIncoming && row.branch && (
                    <DiffClip
                      track={row.branch}
                      color="var(--lime)"
                      half={showTarget ? 'bottom' : 'full'}
                      totalMs={totalMs}
                      contentMs={branchDurMs}
                      playing={audio.playing}
                      currentTimeMsRef={audio.currentTimeMsRef}
                      incoming
                      dimmed={conflict ? conflict.fileConflict && !fileChoiceBranch : false}
                      onClick={conflict?.fileConflict
                        ? () => setTrackChoices(r => ({ ...r, [row.name]: { ...r[row.name], fileChoice: 'branch' } }))
                        : undefined}
                      clickTitle={conflict?.fileConflict ? 'Take the version audio' : undefined}
                      comments={branchClipComments}
                      isCommentPicked={isPicked}
                      onToggleComment={togglePick}
                      bpm={bpm}
                      timeSig={timeSig}
                      barsVersion={barsVersion}
                    />
                  )}
                  {/* New track shown even when target has nothing */}
                  {!showTarget && !showIncoming && row.branch && (
                    <DiffClip
                      track={row.branch}
                      color={on ? 'var(--lime)' : MONO_CLIP_COLOR}
                      half="full"
                      totalMs={totalMs}
                      contentMs={branchDurMs}
                      playing={audio.playing}
                      currentTimeMsRef={audio.currentTimeMsRef}
                      incoming={on}
                      comments={branchClipComments}
                      isCommentPicked={isPicked}
                      onToggleComment={togglePick}
                      bpm={bpm}
                      timeSig={timeSig}
                      barsVersion={barsVersion}
                    />
                  )}
                  {/* Skipped wash */}
                  {!on && !isSame && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, color-mix(in oklab, var(--foreground) 3%, transparent) 6px, color-mix(in oklab, var(--foreground) 3%, transparent) 12px)' }}
                    />
                  )}
                  {/* Removal wash — target-only track opted into deletion */}
                  {removalOn && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, color-mix(in oklab, var(--destructive) 14%, transparent) 6px, color-mix(in oklab, var(--destructive) 14%, transparent) 12px)' }}
                    />
                  )}
                </div>
              </div>
            )
          })}

          {/* Footer note */}
          <div className="px-6 py-5 flex items-center gap-2.5 text-[9px] uppercase tracking-widest text-muted-foreground">
            <span className="size-1.5 rounded-full bg-lime animate-pulse" />
            Adjust selections, listen to the result preview, then hit Apply.
          </div>
        </div>

        {/* Transport — reuses the compare-mode audio engine */}
        <DiffTransportBar
          playing={audio.playing}
          currentTimeMs={audio.currentTimeMs}
          duration={Math.max(audio.duration, 1)}
          onPlay={audio.play}
          onPause={audio.pause}
          onSeek={audio.seek}
          abMode={audio.abMode}
          onAbMode={audio.setAbMode}
          targetName={targetName}
          loaded={audio.loadedA + audio.loadedB}
          total={audio.totalA + audio.totalB}
        />
      </main>
    </div>
  )
}

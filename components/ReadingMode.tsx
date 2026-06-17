'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { sectionLabel } from '@/components/StructureEditor'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { ResourcesCard } from '@/components/ResourcesCard'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { Spinner } from '@/components/ui/Spinner'
import { buildCompositeWaveform } from '@/lib/waveform-decode'
import type { Track, Section, Version, Project, ProjectResource } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadingModePlayer = {
  playing: boolean
  currentTime: number
  duration: number
  loaded: number
  total: number
  play: () => void
  pause: () => void
  seek: (t: number) => void
}

const REHEARSAL_BAR_COUNT = 48
const DECODE_BAR_COUNT = 96

function downsampleBars(bars: number[], targetCount: number): number[] {
  if (bars.length <= targetCount) return bars
  const result: number[] = []
  const step = bars.length / targetCount
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step)
    const end = Math.max(start + 1, Math.floor((i + 1) * step))
    let peak = 0
    for (let j = start; j < end; j++) peak = Math.max(peak, bars[j] ?? 0)
    result.push(peak)
  }
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

function formatChords(chords: string | null | undefined): string {
  if (!chords?.trim()) return '—'
  return chords.trim().split(/\s+/).filter(Boolean).join(' · ')
}

// ─── Master waveform (uikit bar style) ────────────────────────────────────────

function MasterWaveform({
  bars, playedRatio, onSeek, ready,
}: {
  bars: number[]
  playedRatio: number
  onSeek: (ratio: number) => void
  ready: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const seekAt = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    onSeek(ratio)
  }, [onSeek])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!ready) return
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekAt(e.clientX)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    seekAt(e.clientX)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const playheadPct = Math.min(100, Math.max(0, playedRatio * 100))

  return (
    <div
      ref={containerRef}
      className="relative mt-2 h-28 border border-border bg-surface/40 p-2 cursor-pointer touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="relative h-full flex items-end gap-px">
        {bars.map((h, i) => {
          const played = (i + 0.5) / bars.length <= playedRatio
          return (
            <div
              key={i}
              className="flex-1 min-w-0"
              style={{
                height: `${Math.max(6, h * 100)}%`,
                background: 'var(--ember)',
                opacity: ready ? (played ? 0.95 : 0.35) : 0.2,
              }}
            />
          )
        })}
        {ready && (
          <div
            className="absolute top-0 bottom-0 w-px -ml-px bg-foreground pointer-events-none z-10"
            style={{ left: `${playheadPct}%` }}
          />
        )}
      </div>
    </div>
  )
}

// ─── Version drawer ───────────────────────────────────────────────────────────

function VersionDrawer({
  versions, activeVersionId, onSelect, onClose,
}: {
  versions: Version[]
  activeVersionId: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/45 z-[500]" onClick={onClose} />
      <aside className="fixed top-0 left-0 h-full w-[min(76vw,280px)] z-[501] flex flex-col overflow-y-auto bg-surface border-r border-border py-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 mb-3">
          Versions
        </p>
        {versions.map(v => {
          const isActive = v.id === activeVersionId
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => { onSelect(v.id); onClose() }}
              className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-[13px] transition ${
                isActive ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:bg-surface/60'
              }`}
            >
              <span
                className={`size-1.5 rounded-full shrink-0 ${
                  isActive ? 'bg-ember' : v.merged_at ? 'bg-online' : 'bg-muted-foreground'
                }`}
              />
              <span className="flex-1 truncate">{v.name}</span>
              {v.type === 'main' && (
                <span className="text-[9px] uppercase tracking-widest text-ember border border-ember/40 px-1.5 shrink-0">
                  main
                </span>
              )}
            </button>
          )
        })}
      </aside>
    </>
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
    <HoverTooltip label={tooltip} className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        className={`h-9 px-2.5 border text-[9px] font-bold uppercase tracking-widest transition disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active
            ? 'border-ember bg-ember text-white'
            : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
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
  projectId,
  bandId,
  activeTracks,
  barDurationMs,
  visible,
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
  projectId: string
  bandId: string
  activeTracks: Track[]
  barDurationMs: number
  visible: boolean
  sectionLoopOn: boolean
  sectionLoopEnabled: boolean
  onToggleSectionLoop: () => void
  metronomeOn: boolean
  countdownOn: boolean
  isCounting: boolean
  onToggleMetronome: () => void
  onToggleCountdown: () => void
}) {
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const [composite, setComposite] = useState<number[]>(() => new Array(REHEARSAL_BAR_COUNT).fill(0.12))
  const [waveformReady, setWaveformReady] = useState(false)
  const [waveformLoading, setWaveformLoading] = useState(false)
  const [lyrics, setLyrics] = useState<ProjectResource | null>(null)
  const [showResources, setShowResources] = useState(false)

  const audioTrackIds = activeTracks
    .filter(t => t.file_type !== 'midi')
    .map(t => t.id)
    .join(',')

  useEffect(() => {
    if (!visible) return
    const audioCount = audioTrackIds.split(',').filter(Boolean).length
    if (!audioCount) {
      setComposite(new Array(REHEARSAL_BAR_COUNT).fill(0.12))
      setWaveformReady(false)
      setWaveformLoading(false)
      return
    }

    if (player.total > 0 && player.loaded < player.total) {
      setWaveformLoading(true)
      setWaveformReady(false)
      return
    }

    let cancelled = false
    setWaveformLoading(true)

    buildCompositeWaveform(activeTracks, DECODE_BAR_COUNT).then(bars => {
      if (cancelled) return
      setComposite(downsampleBars(bars, REHEARSAL_BAR_COUNT))
      setWaveformReady(true)
      setWaveformLoading(false)
    })

    return () => { cancelled = true }
  }, [visible, audioTrackIds, player.loaded, player.total])

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

  // Defer heavy ResourcesCard until user scrolls near it
  useEffect(() => {
    if (!visible) return
    const t = setTimeout(() => setShowResources(true), 600)
    return () => clearTimeout(t)
  }, [visible, projectId])

  if (!visible) return null

  const playedRatio = player.duration > 0 ? player.currentTime / player.duration : 0
  const progressPct = playedRatio * 100

  function handleSeek(ratio: number) {
    player.seek(ratio * player.duration)
  }

  function sectionStartTime(startBar: number): string {
    return fmt((startBar * barDurationMs) / 1000)
  }

  const isLoading = player.total > 0 && player.loaded < player.total
  const isReady = player.total === 0 || player.loaded === player.total

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      {/* Slim top bar — versions drawer, logo, nav path, account */}
      <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
        <button
          type="button"
          onClick={() => setVersionDrawerOpen(true)}
          aria-label="Versions"
          className="size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
            <rect x="2" y="4" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="2" y="8.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="2" y="12.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Link
            href="/dashboard"
            className="font-display text-sm font-bold tracking-tight text-ember shrink-0 no-underline"
          >
            TRACKBASE
          </Link>
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
              className="hover:text-foreground no-underline truncate min-w-0"
            >
              {project.band_name ?? 'Band'}
            </Link>
            <span className="text-border shrink-0">/</span>
            <span className="text-foreground truncate min-w-0">{project.name}</span>
          </nav>
        </div>

        <AvatarDropdown />
      </header>

      {versionDrawerOpen && (
        <VersionDrawer
          versions={versions}
          activeVersionId={activeVersionId}
          onSelect={onVersionChange}
          onClose={() => setVersionDrawerOpen(false)}
        />
      )}

      {/* Scrollable body — room for player + rotate bar */}
      <div className="flex-1 overflow-y-auto pb-[7.5rem]">

        {/* Project header */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-ember">
            <span className="size-1.5 rounded-full bg-ember animate-pulse-dot" />
            Rehearsal mode
          </div>
          <h1 className="font-display text-3xl uppercase tracking-tighter mt-1 text-foreground">
            {project.name}
          </h1>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
            {project.bpm != null && <span>{project.bpm} BPM</span>}
            {project.key && <span className="text-ember">{project.key}</span>}
            <span>{project.time_signature ?? '4/4'}</span>
            {player.duration > 0 && <span>{fmt(player.duration)}</span>}
          </div>
          {project.band_name && (
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {project.band_name}
            </div>
          )}
        </div>

        {/* Full mix waveform */}
        <div className="px-5 pt-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Full mix
          </div>
          {(isLoading || waveformLoading) && (
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
              {isLoading ? `Loading audio… ${player.loaded}/${player.total}` : 'Building waveform…'}
            </p>
          )}
          {player.total === 0 ? (
            <div className="mt-2 h-28 border border-border bg-surface/40 grid place-items-center">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">No audio tracks</span>
            </div>
          ) : (
            <MasterWaveform
              bars={composite}
              playedRatio={playedRatio}
              onSeek={handleSeek}
              ready={waveformReady && isReady}
            />
          )}
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-muted-foreground mt-1">
            <span>{fmt(player.currentTime)}</span>
            <span>{fmt(player.duration)}</span>
          </div>

          {/* Version pills */}
          {versions.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {versions.map(v => {
                const isActive = v.id === activeVersionId
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onVersionChange(v.id)}
                    className={`shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition ${
                      isActive
                        ? 'bg-ember text-white border-ember'
                        : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
                    }`}
                  >
                    {v.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Structure & chords */}
        <div className="px-5 pt-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Structure & chords
          </div>
          {sections.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground py-4 text-center border border-border">
              No structure added yet
            </p>
          ) : (
            <div className="mt-2 border border-border divide-y divide-border">
              {sections.map(section => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => player.seek((section.start_bar * barDurationMs) / 1000 + 0.001)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface/40 transition"
                >
                  <div className="text-[9px] font-bold uppercase tracking-widest text-ember w-16 shrink-0 truncate">
                    {sectionLabel(section)}
                  </div>
                  <div className="text-xs flex-1 truncate text-foreground">
                    {formatChords(section.chords)}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
                    {sectionStartTime(section.start_bar)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lyrics */}
        {lyrics?.content?.trim() && (
          <div className="px-5 pt-6">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Lyrics
            </div>
            <pre className="mt-2 text-xs whitespace-pre-wrap text-foreground/90 bg-surface border border-border p-3 leading-relaxed font-mono">
              {lyrics.content.trim()}
            </pre>
          </div>
        )}

        {/* Resources — deferred mount for mobile perf */}
        {showResources && (
          <div className="px-5 pt-6 pb-6">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Resources
            </div>
            <ResourcesCard projectId={projectId} projectName={project.name} bare variant="drawer" hideLyrics={!!lyrics?.content?.trim()} hideUploadZone />
          </div>
        )}
      </div>

      {/* Fixed master player — above rotate bar */}
      <div className="absolute bottom-[52px] left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-4 py-3 grid grid-cols-[auto_1fr] grid-rows-2 gap-x-3 gap-y-2 items-center z-10">
        <button
          type="button"
          onClick={() => ((player.playing || isCounting) ? player.pause() : player.play())}
          disabled={!isReady || player.total === 0}
          className="row-span-2 size-12 bg-ember text-white grid place-items-center hover:brightness-110 active:scale-95 transition shrink-0 disabled:opacity-50 disabled:cursor-not-allowed self-center"
          aria-label={(player.playing || isCounting) ? 'Pause' : isLoading ? 'Loading' : 'Play'}
        >
          {isLoading ? (
            <Spinner size={16} tone="white" />
          ) : (
            <span className="text-base translate-x-px">{(player.playing || isCounting) ? '❚❚' : '▶'}</span>
          )}
        </button>
        <div className="flex items-center gap-1.5 min-w-0">
          <RehearsalTransportToggle
            label="Metro"
            active={metronomeOn}
            onClick={onToggleMetronome}
            tooltip="Metronome click track"
          />
          <RehearsalTransportToggle
            label="CD"
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
        <div className="min-w-0 self-stretch flex flex-col justify-center">
          <div
            className="h-1.5 bg-surface-2 relative cursor-pointer"
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
            }}
            onTouchEnd={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              handleSeek(Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width)))
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-ember/40 transition-[width] duration-75" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-[9px] font-mono tabular-nums text-muted-foreground mt-1">
            <span>{fmt(player.currentTime)}</span>
            <span>{fmt(player.duration)}</span>
          </div>
        </div>
      </div>

      {/* Fixed bottom rotate-prompt bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[52px] bg-surface border-t border-border flex items-center justify-center gap-2.5 z-10">
        <span className="rm-rotate-icon" aria-hidden>
          <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
            <rect x="1" y="1" width="16" height="24" rx="3" stroke="var(--ember)" strokeWidth="1.5" />
            <circle cx="9" cy="22" r="1.25" fill="var(--ember)" opacity="0.6" />
          </svg>
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Rotate to open the mixer
        </span>
      </div>
    </div>
  )
}

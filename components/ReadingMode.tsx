'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { sectionLabel } from '@/components/StructureEditor'
import { ResourcesCard } from '@/components/ResourcesCard'
import { waveformBarsCache } from '@/lib/waveformCache'
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

/** Average all cached waveform bars across audio tracks into one composite. */
function buildComposite(tracks: Track[]): number[] {
  const N = 96
  const cached = tracks
    .filter(t => t.file_type !== 'midi')
    .map(t => waveformBarsCache.get(t.id))
    .filter((b): b is number[] => !!b)
  if (!cached.length) return new Array(N).fill(0.12)
  const sum = new Array(N).fill(0)
  for (const bars of cached) {
    for (let i = 0; i < N; i++) sum[i] += bars[i] ?? 0
  }
  const max = Math.max(...sum, 0.001)
  return sum.map(v => v / max)
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

  function clientXToRatio(x: number): number {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (x - rect.left) / rect.width))
  }

  return (
    <div
      ref={containerRef}
      className="mt-2 h-28 flex items-end gap-px border border-border bg-surface/40 p-2 cursor-pointer touch-none"
      onClick={e => onSeek(clientXToRatio(e.clientX))}
      onTouchEnd={e => {
        e.preventDefault()
        onSeek(clientXToRatio(e.changedTouches[0].clientX))
      }}
    >
      {bars.map((h, i) => {
        const played = (i / bars.length) < playedRatio
        return (
          <div
            key={i}
            className={`flex-1 min-w-0 ${ready ? 'animate-draw-wave' : ''}`}
            style={{
              height: `${Math.max(8, h * 100)}%`,
              background: 'var(--ember)',
              opacity: played ? 0.95 : 0.35,
              animationDelay: ready ? `${i * 8}ms` : undefined,
            }}
          />
        )
      })}
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

// ─── Main component ───────────────────────────────────────────────────────────

export function ReadingMode({
  project,
  player,
  sections,
  versions,
  activeVersionId,
  onVersionChange,
  projectId,
  activeTracks,
  barDurationMs,
  visible,
}: {
  project: Project
  player: ReadingModePlayer
  sections: Section[]
  versions: Version[]
  activeVersionId: string
  onVersionChange: (id: string) => void
  projectId: string
  activeTracks: Track[]
  barDurationMs: number
  visible: boolean
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)
  const [composite, setComposite] = useState<number[]>(() => buildComposite(activeTracks))
  const [lyrics, setLyrics] = useState<ProjectResource | null>(null)

  useEffect(() => {
    setComposite(buildComposite(activeTracks))
  }, [activeTracks, player.loaded])

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
  const waveformReady = isReady && player.total > 0

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden transition-opacity duration-200"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Slim top bar — versions + theme */}
      <header className="h-11 shrink-0 flex items-center gap-2.5 px-4 border-b border-border bg-background">
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
        <span className="flex-1 text-[11px] uppercase tracking-widest text-muted-foreground truncate">
          {project.name}
        </span>
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          className="size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition shrink-0"
        >
          {resolvedTheme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
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
          {isLoading && (
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
              Loading… {player.loaded}/{player.total}
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
              ready={waveformReady}
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
                  onClick={() => player.seek((section.start_bar * barDurationMs) / 1000)}
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

        {/* Resources */}
        <div className="px-5 pt-6 pb-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Resources
          </div>
          <ResourcesCard projectId={projectId} projectName={project.name} bare variant="drawer" hideLyrics={!!lyrics?.content?.trim()} />
        </div>
      </div>

      {/* Fixed master player — above rotate bar */}
      <div className="absolute bottom-[52px] left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-4 py-3 flex items-center gap-3 z-10">
        <button
          type="button"
          onClick={() => (player.playing ? player.pause() : player.play())}
          disabled={!isReady || player.total === 0}
          className="size-12 bg-ember text-white grid place-items-center hover:brightness-110 active:scale-95 transition shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={player.playing ? 'Pause' : 'Play'}
        >
          <span className="text-base translate-x-px">{player.playing ? '❚❚' : '▶'}</span>
        </button>
        <div className="flex-1 min-w-0">
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
            <div className="absolute inset-y-0 left-0 bg-ember transition-[width] duration-75" style={{ width: `${progressPct}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-[9px] font-mono tabular-nums text-muted-foreground mt-1">
            <span>{fmt(player.currentTime)}</span>
            <span>{fmt(player.duration)}</span>
          </div>
        </div>
      </div>

      {/* Fixed bottom rotate-prompt bar — unchanged message */}
      <div className="absolute bottom-0 left-0 right-0 h-[52px] bg-surface border-t border-border flex items-center justify-center gap-2.5 z-10">
        <span className="rm-rotate-icon" aria-hidden>
          <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
            <rect x="1" y="1" width="16" height="24" rx="3" stroke="var(--ember)" strokeWidth="1.5" />
            <circle cx="9" cy="22" r="1.25" fill="var(--ember)" opacity="0.6" />
          </svg>
        </span>
        <span className="text-[13px] text-muted-foreground">Rotate to open the mixer</span>
      </div>
    </div>
  )
}

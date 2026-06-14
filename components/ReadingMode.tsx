'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { SECTION_COLORS, sectionLabel } from '@/components/StructureEditor'
import { ResourcesCard } from '@/components/ResourcesCard'
import { waveformBarsCache } from '@/lib/waveformCache'
import type { Track, Section, Version, Project } from '@/lib/types'

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
  const N = 72
  const cached = tracks
    .filter(t => t.file_type !== 'midi')
    .map(t => waveformBarsCache.get(t.id))
    .filter((b): b is number[] => !!b)
  if (!cached.length) return new Array(N).fill(0.4)
  const sum = new Array(N).fill(0)
  for (const bars of cached) for (let i = 0; i < N; i++) sum[i] += bars[i] ?? 0
  const max = Math.max(...sum, 0.001)
  return sum.map(v => v / max)
}

// ─── Master waveform ──────────────────────────────────────────────────────────

function MasterWaveform({
  bars, playedRatio, onSeek,
}: {
  bars: number[]
  playedRatio: number
  onSeek: (ratio: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.offsetWidth || 1
    const H = canvas.offsetHeight || 64
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const accentRaw = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent').trim()
    const accent = accentRaw || '#6366F1'
    const N = bars.length
    const barW = W / N

    for (let i = 0; i < N; i++) {
      const amp = bars[i]
      const barH = Math.max(2, amp * H * 0.9)
      const x = i * barW
      const y = (H - barH) / 2
      ctx.globalAlpha = (i / N) < playedRatio ? 1 : 0.3
      ctx.fillStyle = accent
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(x + 1, y, Math.max(1, barW - 2), barH, 2)
      } else {
        ctx.rect(x + 1, y, Math.max(1, barW - 2), barH)
      }
      ctx.fill()
    }
  }, [bars, playedRatio, resolvedTheme])

  function clientXToRatio(x: number): number {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(1, (x - rect.left) / rect.width))
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: 64, cursor: 'pointer', touchAction: 'none', position: 'relative' }}
      onClick={e => onSeek(clientXToRatio(e.clientX))}
      onTouchEnd={e => { e.preventDefault(); onSeek(clientXToRatio(e.changedTouches[0].clientX)) }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
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
  function dotColor(v: Version) {
    return v.merged_at ? 'var(--green)' : v.type === 'main' ? 'var(--accent)' : 'var(--amber)'
  }
  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500 }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed', top: 0, left: 0, height: '100%',
        width: 'min(76vw, 280px)',
        background: 'var(--bg-surface)',
        borderRight: '0.5px solid var(--border)',
        zIndex: 501,
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
        paddingTop: 20, paddingBottom: 20,
      }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0 16px', marginBottom: 10 }}>
          Versions
        </p>
        {versions.map(v => (
          <button
            key={v.id}
            onClick={() => { onSelect(v.id); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', width: '100%',
              background: v.id === activeVersionId ? 'var(--bg-card)' : 'transparent',
              border: 'none', textAlign: 'left', cursor: 'pointer',
              color: v.id === activeVersionId ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: dotColor(v) }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
            {v.type === 'main' && (
              <span style={{ fontSize: 10, padding: '1px 5px', background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', borderRadius: 4, flexShrink: 0 }}>
                main
              </span>
            )}
          </button>
        ))}
      </div>
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

  // Rebuild composite waveform when tracks or loaded count changes
  useEffect(() => {
    setComposite(buildComposite(activeTracks))
  }, [activeTracks, player.loaded])

  const playedRatio = player.duration > 0 ? player.currentTime / player.duration : 0

  function handleSeek(ratio: number) {
    player.seek(ratio * player.duration)
  }

  function fmtBarRange(startBar: number, endBar: number): string {
    const f = (ms: number) => fmt(ms / 1000)
    return `${f(startBar * barDurationMs)}–${f(endBar * barDurationMs)}`
  }

  const isLoading = player.total > 0 && player.loaded < player.total
  const isReady = player.total === 0 || player.loaded === player.total

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* ── Header ── */}
      <header style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 10,
        background: 'var(--bg-surface)',
        borderBottom: '0.5px solid var(--border)',
      }}>
        <button
          onClick={() => setVersionDrawerOpen(true)}
          aria-label="Versions"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          {/* hamburger */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="2" y="4" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="2" y="8.25" width="14" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="2" y="12.5" width="14" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>

        <span style={{
          flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {project.name}
        </span>

        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          {resolvedTheme === 'dark' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </header>

      {/* ── Version drawer ── */}
      {versionDrawerOpen && (
        <VersionDrawer
          versions={versions}
          activeVersionId={activeVersionId}
          onSelect={onVersionChange}
          onClose={() => setVersionDrawerOpen(false)}
        />
      )}

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 60 }}>

        {/* Master player section */}
        <div style={{ padding: '20px 16px 0' }}>
          {/* Play row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <button
              onClick={() => player.playing ? player.pause() : player.play()}
              disabled={!isReady || player.total === 0}
              style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'var(--accent)', border: 'none', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: !isReady || player.total === 0 ? 'not-allowed' : 'pointer',
                opacity: !isReady || player.total === 0 ? 0.55 : 1,
                flexShrink: 0, transition: 'opacity 0.15s',
              }}
            >
              {player.playing ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div>
              <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                {isLoading
                  ? `Loading… ${player.loaded}/${player.total}`
                  : player.total === 0
                    ? 'No audio tracks'
                    : player.playing ? 'Playing' : 'Ready'}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(player.currentTime)} / {fmt(player.duration)}
              </p>
            </div>
          </div>

          {/* Master waveform */}
          <MasterWaveform bars={composite} playedRatio={playedRatio} onSeek={handleSeek} />

          {/* Version pills */}
          {versions.length > 1 && (
            <div style={{
              marginTop: 12, display: 'flex', gap: 6, overflowX: 'auto',
              paddingBottom: 2, WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}>
              {versions.map(v => (
                <button
                  key={v.id}
                  onClick={() => onVersionChange(v.id)}
                  style={{
                    flexShrink: 0, fontSize: 12, padding: '4px 10px', borderRadius: 20,
                    border: `0.5px solid ${v.id === activeVersionId ? 'var(--accent)' : 'var(--border)'}`,
                    background: v.id === activeVersionId ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: v.id === activeVersionId ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Structure section */}
        <div style={{ padding: '24px 16px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Structure
          </p>
          {sections.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0', margin: 0 }}>
              No structure added yet
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sections.map(section => {
                const colors = SECTION_COLORS[section.type]
                const chords = section.chords?.trim()
                  ? section.chords.trim().split(/\s+/).filter(Boolean)
                  : []
                return (
                  <div
                    key={section.id}
                    onClick={() => player.seek((section.start_bar * barDurationMs) / 1000)}
                    style={{
                      padding: '10px 12px',
                      background: 'var(--bg-surface)',
                      border: '0.5px solid var(--border)',
                      borderLeft: `3px solid ${section.color || colors.fg}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: chords.length ? 6 : 0 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: colors.bg, color: colors.fg,
                        textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                      }}>
                        {sectionLabel(section)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto', flexShrink: 0 }}>
                        {fmtBarRange(section.start_bar, section.end_bar)}
                      </span>
                    </div>
                    {chords.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {chords.map((chord, i) => (
                          <span
                            key={`${section.id}-${i}`}
                            style={{
                              fontSize: 11, padding: '2px 6px', borderRadius: 4,
                              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                              color: 'var(--text-sec)',
                            }}
                          >
                            {chord}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Resources section */}
        <div style={{ padding: '24px 16px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Resources
          </p>
          <ResourcesCard projectId={projectId} projectName={project.name} bare />
        </div>
      </div>

      {/* ── Fixed bottom rotate-prompt bar ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 52,
        background: 'var(--bg-surface)',
        borderTop: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        zIndex: 10,
      }}>
        <span className="rm-rotate-icon" aria-hidden>
          <svg width="18" height="26" viewBox="0 0 18 26" fill="none">
            <rect x="1" y="1" width="16" height="24" rx="3" stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx="9" cy="22" r="1.25" fill="var(--accent)" opacity="0.6" />
          </svg>
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Rotate to open the mixer</span>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { ReadingMode, type ReadingModePlayer } from '@/components/ReadingMode'
import { MobileMixerPortrait, type MobileMixerPortraitProps } from '@/components/MobileMixerPortrait'
import type { Project, Section, Track, Version } from '@/lib/types'

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

// ─── Mobile experience shell ──────────────────────────────────────────────────

export type MobileExperienceProps = {
  project: Project
  bandId: string
  versions: Version[]
  activeVersionId: string
  onVersionChange: (id: string) => void
  player: ReadingModePlayer
  sections: Section[]
  projectId: string
  activeTracks: Track[]
  barDurationMs: number
  isMainVersion: boolean
  sectionLoopOn: boolean
  sectionLoopEnabled: boolean
  onToggleSectionLoop: () => void
  metronomeOn: boolean
  countdownOn: boolean
  isCounting: boolean
  onToggleMetronome: () => void
  onToggleCountdown: () => void
  mixer: Omit<MobileMixerPortraitProps, 'onExit'>
}

export function MobileExperience({
  project,
  bandId,
  versions,
  activeVersionId,
  onVersionChange,
  player,
  sections,
  projectId,
  activeTracks,
  barDurationMs,
  isMainVersion,
  sectionLoopOn,
  sectionLoopEnabled,
  onToggleSectionLoop,
  metronomeOn,
  countdownOn,
  isCounting,
  onToggleMetronome,
  onToggleCountdown,
  mixer,
}: MobileExperienceProps) {
  const [mode, setMode] = useState<'rehearse' | 'mixer'>('rehearse')
  const [versionDrawerOpen, setVersionDrawerOpen] = useState(false)

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

      {/* Mode switch — Rehearsal | Mixer */}
      <div className="px-3 pt-3 pb-2 border-b border-border bg-surface/40 shrink-0">
        <div className="grid grid-cols-2 border border-border bg-background">
          {(['rehearse', 'mixer'] as const).map(m => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`py-2 text-[10px] font-bold uppercase tracking-widest transition ${
                  active ? 'bg-ember text-white' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'rehearse' ? '● Rehearsal' : '≡ Mixer'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        {mode === 'rehearse' ? (
          <ReadingMode
            embedded
            visible
            project={project}
            player={player}
            sections={sections}
            versions={versions}
            activeVersionId={activeVersionId}
            onVersionChange={onVersionChange}
            projectId={projectId}
            bandId={bandId}
            activeTracks={activeTracks}
            barDurationMs={barDurationMs}
            isMainVersion={isMainVersion}
            sectionLoopOn={sectionLoopOn}
            sectionLoopEnabled={sectionLoopEnabled}
            onToggleSectionLoop={onToggleSectionLoop}
            metronomeOn={metronomeOn}
            countdownOn={countdownOn}
            isCounting={isCounting}
            onToggleMetronome={onToggleMetronome}
            onToggleCountdown={onToggleCountdown}
          />
        ) : (
          <MobileMixerPortrait {...mixer} onExit={() => setMode('rehearse')} />
        )}
      </div>
    </div>
  )
}

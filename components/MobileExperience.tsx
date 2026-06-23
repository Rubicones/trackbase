'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { ReadingMode, type ReadingModePlayer } from '@/components/ReadingMode'
import { MobileMixerPortrait, type MobileMixerPortraitProps } from '@/components/MobileMixerPortrait'
import { MobileMixerVersionBar } from '@/components/MobileMixerVersionBar'
import { ChatLauncherButton } from '@/components/chat/ChatDock'
import { ProjectTour, TourHelpButton } from '@/components/onboarding/ProjectTour'
import { buildMobileProjectTourSteps } from '@/components/onboarding/mobileProjectTourSteps'
import { sortMobileVersions } from '@/lib/versionSort'
import type { Project, Section, Track, Version } from '@/lib/types'

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
  onNewBranch: () => void
  commentMode: boolean
  commentCount: number
  onToggleCommentMode: () => void
  mixer: MobileMixerPortraitProps
  onOpenChat?: () => void
  chatUnread?: number
  showTour?: boolean
  onTourFinish?: () => void
  onTourSkip?: () => void
  storageFull?: boolean
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
  onNewBranch,
  commentMode,
  commentCount,
  onToggleCommentMode,
  mixer,
  onOpenChat,
  chatUnread = 0,
  showTour = false,
  onTourFinish,
  onTourSkip,
  storageFull = false,
}: MobileExperienceProps) {
  const [mode, setMode] = useState<'rehearse' | 'mixer'>('rehearse')
  const [localTourOpen, setLocalTourOpen] = useState(false)
  const sortedVersions = useMemo(() => sortMobileVersions(versions), [versions])
  const modeRef = useRef(mode)
  modeRef.current = mode

  const tourOpen = showTour || localTourOpen
  const mobileTourSteps = useMemo(
    () => buildMobileProjectTourSteps(() => modeRef.current),
    [],
  )
  const prevTourOpenRef = useRef(false)

  useEffect(() => {
    if (tourOpen && !prevTourOpenRef.current) setMode('rehearse')
    prevTourOpenRef.current = tourOpen
  }, [tourOpen])

  function finishTour() {
    setLocalTourOpen(false)
    onTourFinish?.()
  }

  function skipTour() {
    setLocalTourOpen(false)
    onTourSkip?.()
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      {/* Slim top bar — logo, nav path, account */}
      <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
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

        <TourHelpButton onClick={() => setLocalTourOpen(true)} />
        <AvatarDropdown />
      </header>

      {/* Chat bar + mode switch */}
      <div className="px-3 pt-3 pb-2 border-b border-border bg-surface/40 shrink-0 space-y-2">
        {onOpenChat && (
          <div data-tour="mobile-chat">
            <ChatLauncherButton
              variant="bar"
              unread={chatUnread}
              onClick={onOpenChat}
            />
          </div>
        )}
        <div className="grid grid-cols-2 border border-border bg-background" data-tour="mobile-mode-switch">
          {(['rehearse', 'mixer'] as const).map(m => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                data-tour={m === 'rehearse' ? 'mobile-mode-rehearse' : 'mobile-mode-mixer'}
                className={`py-2.5 text-[10px] font-bold uppercase tracking-widest transition ${
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
          <>
            <div data-tour="mobile-mixer-version-bar">
              <MobileMixerVersionBar
                versions={sortedVersions}
                activeId={activeVersionId}
                onSelect={onVersionChange}
                onNewBranch={onNewBranch}
                commentMode={commentMode}
                commentCount={commentCount}
                onToggleCommentMode={onToggleCommentMode}
              />
            </div>
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
            storageFull={storageFull}
          />
          </>
        ) : (
          <MobileMixerPortrait {...mixer} />
        )}
      </div>

      <ProjectTour
        projectName={project.name}
        show={tourOpen}
        steps={mobileTourSteps}
        onFinish={finishTour}
        onSkip={skipTour}
      />
    </div>
  )
}

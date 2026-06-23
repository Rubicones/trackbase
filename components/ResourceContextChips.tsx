'use client'

import type { ProjectResource, Version } from '@/lib/types'
import { IconBranch, IconNote } from '@/components/chat/ContextIcons'

export function resolveResourceChipNames(
  resource: Pick<
    ProjectResource,
    'context_version_id' | 'context_track_id' | 'context_version_name' | 'context_track_name'
  >,
  versions: Version[] = [],
): { versionName: string | null; trackName: string | null } {
  let versionName = resource.context_version_name ?? null
  let trackName = resource.context_track_name ?? null

  if (!versionName && resource.context_version_id) {
    versionName = versions.find(v => v.id === resource.context_version_id)?.name ?? null
  }

  if (!trackName && resource.context_track_id) {
    for (const version of versions) {
      const track = version.tracks?.find(t => t.id === resource.context_track_id)
      if (track) {
        trackName = track.display_name ?? track.name
        break
      }
    }
  }

  return { versionName, trackName }
}

export function ResourceContextChips({
  versionName,
  trackName,
  compact = false,
  className = '',
}: {
  versionName?: string | null
  trackName?: string | null
  compact?: boolean
  className?: string
}) {
  const showBranch = !!versionName
  const showTrack = !!trackName
  if (!showBranch && !showTrack) return null

  return (
    <span
      className={`inline-flex max-w-full items-stretch border border-border bg-surface text-[9px] font-mono overflow-hidden shrink-0 ${className}`}
    >
      {showBranch && (
        <span className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-ember${showTrack ? ' border-r border-border' : ''}`}>
          <IconBranch size={12} />
          <span className={compact ? 'max-w-[2.75rem] truncate' : 'max-w-[4.5rem] truncate'}>
            {versionName}
          </span>
        </span>
      )}
      {showTrack && (
        <span className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-foreground${compact ? ' max-w-[3.5rem]' : ' max-w-[9rem]'} overflow-hidden`}>
          <IconNote size={12} />
          <span className="truncate">{trackName}</span>
        </span>
      )}
    </span>
  )
}

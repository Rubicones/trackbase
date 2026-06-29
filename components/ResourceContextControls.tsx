'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectResource, Version } from '@/lib/types'
import { SpinnerBars } from '@/components/ui/Spinner'
import { IconBranch, IconNote } from '@/components/chat/ContextIcons'
import { resolveResourceChipNames } from './ResourceContextChips'
import { getVersionDisplayName } from '@/lib/versionSort'

function IconClose({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconPlus({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export type ResourceContextDraft = {
  context_version_id: string | null
  context_track_id: string | null
}

export function resourceContextDraft(resource: ProjectResource): ResourceContextDraft {
  return {
    context_version_id: resource.context_version_id ?? null,
    context_track_id: resource.context_track_id ?? null,
  }
}

async function patchResourceContext(
  projectId: string,
  resourceId: string,
  draft: ResourceContextDraft,
): Promise<ProjectResource | null> {
  const res = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!res.ok) return null
  const { resource } = await res.json()
  return resource
}

/** Matches chat ComposerChip — pick branch / track. */
function ComposerChip({
  icon,
  label,
  active = false,
  chipRef,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  chipRef?: React.RefObject<HTMLButtonElement | null>
  onClick: () => void
}) {
  return (
    <button
      ref={chipRef}
      type="button"
      data-stop-row-expand
      onPointerDown={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-widest transition ${
        active
          ? 'border-lime bg-lime-soft text-lime'
          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground'
      }`}
    >
      {icon}
      {label}
      {!active && <span className="opacity-60"><IconPlus /></span>}
    </button>
  )
}

/** Matches chat ContextPopover — portaled so overflow-hidden parents cannot clip it. */
function ContextPopover({
  anchorRef,
  mode,
  versions,
  versionsLoading,
  selectedVersionId,
  onClose,
  onPickVersion,
  onPickTrack,
  popoverPlacement = 'below',
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  mode: 'branch' | 'track'
  versions: Version[]
  versionsLoading: boolean
  selectedVersionId?: string | null
  onClose: () => void
  onPickVersion: (id: string, name: string) => void
  onPickTrack: (id: string, name: string, versionId: string) => void
  popoverPlacement?: 'below' | 'above'
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number; above: boolean } | null>(null)

  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const popoverHeight = popoverRef.current?.offsetHeight ?? 260
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const above =
      popoverPlacement === 'above'
      || (popoverPlacement === 'below' && spaceBelow < popoverHeight + 12 && spaceAbove > spaceBelow)

    setCoords({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 224 - 8)),
      top: above ? rect.top - 4 : rect.bottom + 4,
      above,
    })
  }, [anchorRef, popoverPlacement])

  useLayoutEffect(() => {
    reposition()
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [reposition, mode, versions.length, versionsLoading])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose, anchorRef])

  const trackVersion =
    mode === 'track'
      ? versions.find(v => v.id === selectedVersionId)
        ?? versions.find(v => v.type === 'main')
        ?? versions[0]
      : undefined
  const tracks = trackVersion?.tracks ?? []

  if (typeof document === 'undefined' || !coords) return null

  return createPortal(
    <div
      ref={popoverRef}
      data-stop-row-expand
      data-resource-context-popover
      className="fixed z-[6000] w-56 max-h-64 overflow-y-auto scrollbar-none border border-border bg-surface-2 shadow-2xl"
      style={{
        left: coords.left,
        top: coords.top,
        transform: coords.above ? 'translateY(-100%)' : undefined,
      }}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="px-2 py-1.5 border-b border-border text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {mode === 'branch' ? 'Attach version' : `Attach track${trackVersion ? ` · ${getVersionDisplayName(trackVersion)}` : ''}`}
      </div>
      {versionsLoading && (
        <div className="flex justify-center py-3" role="status" aria-label="Loading versions and tracks">
          <SpinnerBars />
        </div>
      )}
      {!versionsLoading && mode === 'branch' && versions.length === 0 && (
        <div className="px-2 py-3 text-[10px] text-muted-foreground text-center">No versions</div>
      )}
      {!versionsLoading && mode === 'branch' && versions.map(v => (
        <button
          key={v.id}
          type="button"
          onClick={() => onPickVersion(v.id, getVersionDisplayName(v))}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface transition bg-transparent border-0 cursor-pointer"
        >
          <span className="text-lime shrink-0"><IconBranch size={12} /></span>
          <span className="truncate">{getVersionDisplayName(v)}</span>
          {v.type === 'main' && (
            <span className="ml-auto text-[8px] uppercase tracking-widest text-muted-foreground shrink-0">Master</span>
          )}
        </button>
      ))}
      {!versionsLoading && mode === 'track' && tracks.length === 0 && (
        <div className="px-2 py-3 text-[10px] text-muted-foreground text-center">No tracks</div>
      )}
      {!versionsLoading && mode === 'track' && tracks.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPickTrack(t.id, t.display_name ?? t.name, trackVersion!.id)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface transition bg-transparent border-0 cursor-pointer"
        >
          <IconNote size={12} />
          <span className="truncate">{t.display_name ?? t.name}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

/** Matches chat attached-chip row (composer + message segments). */
function AttachedChip({
  icon,
  label,
  accent = false,
  compact = false,
  onNavigate,
  onRemove,
  disabled = false,
}: {
  icon: React.ReactNode
  label: string
  accent?: boolean
  compact?: boolean
  onNavigate?: () => void
  onRemove: () => void
  disabled?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono max-w-full">
      <span className={accent ? 'text-lime shrink-0' : 'shrink-0'}>{icon}</span>
      <button
        type="button"
        disabled={disabled}
        data-stop-row-expand
        onPointerDown={e => e.stopPropagation()}
        onTouchEnd={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation()
          onNavigate?.()
        }}
        className={`truncate bg-transparent border-0 cursor-pointer p-0 font-mono text-[10px] ${
          accent ? 'text-lime' : 'text-foreground'
        } ${compact ? 'max-w-[2.75rem]' : 'max-w-[4.5rem]'} ${onNavigate ? 'hover:brightness-110' : ''}`}
      >
        {label}
      </button>
      <button
        type="button"
        disabled={disabled}
        data-stop-row-expand
        onPointerDown={e => e.stopPropagation()}
        onTouchEnd={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="Remove"
        className="ml-0.5 text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer p-0 shrink-0"
      >
        <IconClose size={10} />
      </button>
    </span>
  )
}

/** Inline branch/track chips — same pick + attach UX as chat. */
export function ResourceContextControls({
  resource,
  projectId,
  versions = [],
  compact = false,
  editing = false,
  draft,
  onDraftChange,
  onUpdated,
  onNavigateVersion,
  onNavigateTrack,
  popoverPlacement = 'below',
}: {
  resource: ProjectResource
  projectId: string
  versions?: Version[]
  compact?: boolean
  editing?: boolean
  draft?: ResourceContextDraft
  onDraftChange?: (draft: ResourceContextDraft) => void
  onUpdated?: (resource: ProjectResource) => void
  onNavigateVersion?: (versionId: string) => void
  onNavigateTrack?: (trackId: string, versionId: string) => void
  popoverPlacement?: 'below' | 'above'
}) {
  const [picker, setPicker] = useState<'branch' | 'track' | null>(null)
  const [saving, setSaving] = useState(false)
  const [versionsLocal, setVersionsLocal] = useState<Version[]>(versions)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const branchChipRef = useRef<HTMLButtonElement>(null)
  const trackChipRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (versions.length > 0) setVersionsLocal(versions)
  }, [versions])

  useEffect(() => {
    if (!picker || versions.length > 0 || versionsLocal.length > 0) return
    let cancelled = false
    setVersionsLoading(true)
    fetch(`/api/projects/${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelled && data?.versions) setVersionsLocal(data.versions)
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false)
      })
    return () => { cancelled = true }
  }, [picker, projectId, versions.length, versionsLocal.length])

  const versionsForPicker = versions.length > 0 ? versions : versionsLocal
  const pickerAnchorRef = picker === 'track' ? trackChipRef : branchChipRef

  const contextIds = editing && draft
    ? draft
    : {
        context_version_id: resource.context_version_id ?? null,
        context_track_id: resource.context_track_id ?? null,
      }

  const pseudoResource = {
    ...resource,
    context_version_id: contextIds.context_version_id,
    context_track_id: contextIds.context_track_id,
  }
  const { versionName, trackName } = resolveResourceChipNames(pseudoResource, versionsForPicker)

  const showBranch = !!contextIds.context_version_id
  const showTrack = !!contextIds.context_track_id
  const branchLabel = versionName ?? 'Version'
  const trackLabel = trackName ?? 'Track'

  async function applyContext(next: ResourceContextDraft) {
    if (editing) {
      onDraftChange?.(next)
      setPicker(null)
      return
    }
    setSaving(true)
    try {
      const updated = await patchResourceContext(projectId, resource.id, next)
      if (updated) onUpdated?.(updated)
    } finally {
      setSaving(false)
      setPicker(null)
    }
  }

  function pickBranch(versionId: string, _name: string) {
    let trackId = contextIds.context_track_id
    if (trackId) {
      const valid = versionsForPicker
        .find(v => v.id === versionId)
        ?.tracks?.some(t => t.id === trackId)
      if (!valid) trackId = null
    }
    void applyContext({ context_version_id: versionId, context_track_id: trackId })
  }

  function pickTrack(trackId: string, _name: string, versionId: string) {
    void applyContext({
      context_version_id: versionId,
      context_track_id: trackId,
    })
  }

  function clearBranch() {
    void applyContext({ context_version_id: null, context_track_id: null })
  }

  function clearTrack() {
    void applyContext({
      context_version_id: contextIds.context_version_id,
      context_track_id: null,
    })
  }

  return (
    <div
      className="relative flex flex-wrap items-center gap-1 min-w-0"
      data-stop-row-expand
      data-resource-context
    >
      {showBranch ? (
        <AttachedChip
          icon={<IconBranch size={12} />}
          label={branchLabel}
          accent
          compact={compact}
          disabled={saving}
          onNavigate={
            contextIds.context_version_id && onNavigateVersion
              ? () => onNavigateVersion(contextIds.context_version_id!)
              : undefined
          }
          onRemove={clearBranch}
        />
      ) : (
        <ComposerChip
          chipRef={branchChipRef}
          icon={<span className="text-lime"><IconBranch size={12} /></span>}
          label="version"
          onClick={() => setPicker(p => (p === 'branch' ? null : 'branch'))}
        />
      )}

      {showTrack ? (
        <AttachedChip
          icon={<IconNote size={12} />}
          label={trackLabel}
          compact={compact}
          disabled={saving}
          onNavigate={
            contextIds.context_track_id && contextIds.context_version_id && onNavigateTrack
              ? () => onNavigateTrack(contextIds.context_track_id!, contextIds.context_version_id!)
              : undefined
          }
          onRemove={clearTrack}
        />
      ) : (
        <ComposerChip
          chipRef={trackChipRef}
          icon={<IconNote size={12} />}
          label="track"
          onClick={() => setPicker(p => (p === 'track' ? null : 'track'))}
        />
      )}

      {picker && (
        <ContextPopover
          anchorRef={pickerAnchorRef}
          mode={picker}
          versions={versionsForPicker}
          versionsLoading={versionsLoading}
          selectedVersionId={contextIds.context_version_id}
          popoverPlacement={popoverPlacement}
          onClose={() => setPicker(null)}
          onPickVersion={pickBranch}
          onPickTrack={pickTrack}
        />
      )}
    </div>
  )
}

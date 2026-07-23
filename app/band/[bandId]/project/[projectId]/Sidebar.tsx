'use client'

// Version history sidebar + resources + storage meter — extracted verbatim from page.tsx.
import React, { useRef, useState } from 'react'
import type { Version } from '@/lib/types'
import { SectionLabel } from '@/components/design/AppShell'
import { Skeleton } from '@/components/ui/Skeleton'
import { ResourcesCard } from '@/components/ResourcesCard'
import { VersionListName } from '@/components/VersionListName'
import { getVersionDisplayName } from '@/lib/versionSort'
import { useResourcesSidebarOpen } from '@/lib/useResourcesSidebarOpen'
import { formatStorageLimit } from '@/lib/bandStorage'
import { fmtDate, formatBytes, versionTagStyle } from './mixerUtils'

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar({ versions, activeId, onSelect, onNewBranch, onMerge, onRenameVersion, storageUsed, storageLimit, storageFull, commentCounts, projectId, projectName, isOpen, compact = false, isDark = false, resourceFilterTrackId = null, resourceFilterTrackName = null, onClearResourceFilter, onNavigateResourceVersion, onNavigateResourceTrack, versionSwitchDisabled = false, deferResources = false }: {
  versions: Version[]; activeId: string
  onSelect: (id: string) => void; onNewBranch: () => void; onMerge: (id: string) => void
  onRenameVersion?: (id: string, name: string) => void
  storageUsed: number
  storageLimit: number
  storageFull: boolean
  commentCounts: Record<string, number>
  projectId: string
  projectName: string
  isOpen?: boolean
  compact?: boolean
  isDark?: boolean
  resourceFilterTrackId?: string | null
  resourceFilterTrackName?: string | null
  onClearResourceFilter?: () => void
  onNavigateResourceVersion?: (versionId: string) => void
  onNavigateResourceTrack?: (trackId: string, versionId: string) => void
  versionSwitchDisabled?: boolean
  /** Skip mounting ResourcesCard (loading skeleton) so it does not fetch then remount. */
  deferResources?: boolean
}) {
  const [hideMerged, setHideMerged] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  function startRename(v: Version) {
    if (!onRenameVersion || v.type === 'main') return
    setRenamingId(v.id)
    setRenameValue(getVersionDisplayName(v))
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 0)
  }

  function commitRename() {
    const id = renamingId
    setRenamingId(null)
    if (!id) return
    const trimmed = renameValue.trim()
    if (trimmed) onRenameVersion?.(id, trimmed)
  }
  const main = versions.find(v => v.type === 'main')
  const branches = versions.filter(v => v.type === 'branch')
  const listedVersions = [main, ...branches].filter(Boolean).filter(
    v => !hideMerged || !v!.merged_at || v!.id === activeId,
  )
  const active = versions.find(v => v.id === activeId)
  const canMerge = active?.type === 'branch' && !active.merged_at

  const staticActions: { label: string; icon: React.ReactNode; action: () => void }[] = [
    {
      label: '+ New version',
      icon: <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9" /><circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9" /><path d="M3 4.5V7.5M3 4.5C3 7 6 7 6 9H7.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" /></svg>,
      action: onNewBranch,
    },
  ]

  const isChecking = false
  const storagePct = Math.min(100, (storageUsed / storageLimit) * 100)

  const { open: resourcesOpen, toggle: toggleResourcesOpen } = useResourcesSidebarOpen()

  return (
    <aside
      data-tour="versions-sidebar"
      className={`project-mixer-sidebar w-[200px] shrink-0 flex flex-col h-full overflow-hidden border-r border-border ${
        compact ? 'bg-surface' : 'bg-surface/30'
      }${isOpen ? ' sidebar-open' : ''}`}
    >
      {/* ── Version history: flex half, scrolls internally, grows when Resources collapses ── */}
      <div className="flex flex-col border-b border-border min-h-0" style={{ flex: '1 1 0' }}>
        {/* Fixed header */}
        <div className={compact ? 'px-3 pt-3 pb-1 shrink-0' : 'px-4 pt-4 pb-1 shrink-0'}>
          <SectionLabel>VERSION HISTORY</SectionLabel>
          <button
            type="button"
            role="checkbox"
            aria-checked={hideMerged}
            onClick={() => setHideMerged(v => !v)}
            className="flex items-center gap-2 mt-1.5 cursor-pointer select-none bg-transparent border-0 p-0 text-left"
          >
            <span
              className={`size-2 shrink-0 rounded-none border transition-colors ${
                hideMerged ? 'bg-lime border-lime' : 'bg-transparent border-border'
              }`}
              aria-hidden
            />
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Hide applied
            </span>
          </button>
        </div>

        {/* Scrollable version list */}
        <div className="overflow-y-auto scrollbar-none min-h-0 flex-1">
          <div className={compact ? 'px-1 pb-1 space-y-px' : 'px-2 pb-2 space-y-px'}>
            {listedVersions.map(v => {
              const isActive = v!.id === activeId
              const switchBlocked = versionSwitchDisabled && !isActive
              const comments = commentCounts[v!.id] ?? 0
              const tagStyle = versionTagStyle(v!.tag, isDark)
              const isRenaming = renamingId === v!.id
              return (
                <div
                  key={v!.id}
                  role="button"
                  tabIndex={switchBlocked ? -1 : 0}
                  aria-disabled={switchBlocked}
                  onClick={() => {
                    if (switchBlocked || isRenaming) return
                    // Tapping the already-active branch again opens rename — works as a
                    // touch-friendly alternative to double-click (mirrors the structure editor).
                    if (isActive && v!.type === 'branch' && onRenameVersion) startRename(v!)
                    else onSelect(v!.id)
                  }}
                  onKeyDown={e => {
                    if (switchBlocked || isRenaming) return
                    if (e.key === 'Enter' || e.key === ' ') onSelect(v!.id)
                  }}
                  className={`group w-full text-left flex items-center gap-2 px-1.5 py-0.5 transition-colors cursor-pointer ${
                    isActive ? 'bg-lime/10' : switchBlocked
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-surface-2'
                  }`}
                >
                  {/* Square indicator */}
                  <span
                    className="shrink-0 inline-block"
                    style={{
                      width: 8, height: 8, borderRadius: 1,
                      background: isActive
                        ? 'var(--lime)'
                        : v!.merged_at
                          ? 'var(--color-online)'
                          : 'var(--border)',
                    }}
                  />
                  {/* Version name + sub-info */}
                  <span className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value.slice(0, 60))}
                        onClick={e => e.stopPropagation()}
                        onDoubleClick={e => e.stopPropagation()}
                        onBlur={commitRename}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="w-full bg-background border border-lime px-1 py-0.5 text-[11px] font-bold text-foreground outline-none"
                      />
                    ) : compact ? (
                      <span onDoubleClick={e => { e.stopPropagation(); startRename(v!) }}>
                        <VersionListName version={v!} className="block text-[10px] font-bold text-foreground truncate leading-tight" />
                      </span>
                    ) : (
                      <>
                        <span onDoubleClick={e => { e.stopPropagation(); startRename(v!) }}>
                          <VersionListName version={v!} className="block text-[11px] font-bold text-foreground truncate" />
                        </span>
                        <span className="block text-[9px] text-muted-foreground uppercase tracking-widest mt-0.5 truncate">
                          {fmtDate(v!.created_at)}{comments > 0 ? ` · ${comments} CMT` : ''}
                        </span>
                      </>
                    )}
                  </span>
                  {/* Tag pill — desktop only, not on Master */}
                  {!compact && tagStyle && v!.type !== 'main' && (
                    <span
                      className="shrink-0 hidden sm:block font-bold tracking-widest whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{
                        fontSize: 9,
                        padding: '2px 5px',
                        background: tagStyle.bg,
                        color: '#fff',
                        maxWidth: 80,
                        borderRadius: 0,
                      }}
                    >
                      {tagStyle.label}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Fixed footer: apply + new version — always visible */}
        <div className={`shrink-0 border-t border-border ${compact ? 'p-2' : 'px-3 py-2'} space-y-1`}>
          {canMerge && (
            <button
              type="button"
              onClick={() => !isChecking && onMerge(activeId)}
              disabled={isChecking}
              className="w-full text-left border border-lime/50 text-lime bg-lime-soft py-2 px-3 uppercase tracking-widest text-[10px] hover:bg-lime/20 transition disabled:opacity-50"
            >
              {isChecking ? 'Checking…' : 'Apply version →'}
            </button>
          )}
          {staticActions.map(({ label, icon, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              data-tour="new-branch-button"
              className="w-full text-left border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime transition flex items-center gap-2"
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Resources: collapsible, fills remaining space ── */}
      {!compact && !deferResources && (
        <div
          className="flex flex-col min-h-0 overflow-hidden border-b border-border"
          style={{ flex: resourcesOpen ? '1 1 0' : '0 0 auto' }}
        >
          <div className={`px-2 pt-2${resourcesOpen ? ' pb-2 flex-1 overflow-y-auto scrollbar-none min-h-0' : ' pb-0 overflow-hidden'}`}>
            <ResourcesCard
              projectId={projectId}
              projectName={projectName}
              bare
              variant="sidebar"
              hideLyrics
              storageFull={storageFull}
              filterTrackId={resourceFilterTrackId}
              filterTrackName={resourceFilterTrackName}
              onClearFilter={onClearResourceFilter}
              versions={versions}
              onNavigateVersion={onNavigateResourceVersion}
              onNavigateTrack={onNavigateResourceTrack}
              collapsed={!resourcesOpen}
              onToggleCollapse={toggleResourcesOpen}
            />
          </div>
        </div>
      )}
      {!compact && deferResources && (
        <div className="flex flex-col shrink-0 overflow-hidden border-b border-border px-4 py-3 gap-2">
          <SectionLabel>RESOURCES</SectionLabel>
          <Skeleton width="70%" height={12} />
          <Skeleton width="45%" height={12} />
        </div>
      )}

      <div className={`shrink-0 border-t border-border ${compact ? 'p-3' : 'px-4 py-2'}`}>
        <SectionLabel>STORAGE · {formatStorageLimit(storageLimit)}</SectionLabel>
        {compact ? (
          <div className="text-[10px] tabular-nums mt-1 text-muted-foreground truncate">
            {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
            <span className={`ml-2 ${storageFull ? 'text-destructive' : storagePct > 95 ? 'text-destructive' : 'text-lime'}`}>
              {Math.round(storagePct)}%
            </span>
          </div>
        ) : (
          <>
            <div className="text-[10px] tabular-nums mt-1 text-muted-foreground">
              {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
            </div>
            <div className="h-1 bg-surface-2 mt-1 overflow-hidden">
              <div
                className={`h-full transition-all ${storageFull || storagePct > 95 ? 'bg-destructive' : 'bg-lime'}`}
                style={{ width: `${storagePct}%` }}
              />
            </div>
            {storageFull ? (
              <p className="text-[9px] text-destructive mt-1 m-0">Storage full — delete tracks or files to upload more</p>
            ) : storageUsed / storageLimit > 0.95 ? (
              <p className="text-[9px] text-destructive mt-1 m-0">Almost full</p>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}

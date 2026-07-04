'use client'

import { useMemo, useRef, useState } from 'react'
import type { Version } from '@/lib/types'
import { sortMobileVersions } from '@/lib/versionSort'
import { VersionListName } from '@/components/VersionListName'

export function CommentToggleBtn({
  active, count, onClick, className = 'size-8', variant = 'icon', showCount = true, tourId,
}: {
  active: boolean
  count: number
  onClick: () => void
  className?: string
  /** icon = boxed toolbar button; bar = inline segment matching + Branch */
  variant?: 'icon' | 'bar'
  showCount?: boolean
  tourId?: string
}) {
  const isBar = variant === 'bar'
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={tourId ?? 'comments-toggle'}
      aria-label={active ? 'Exit comment mode' : 'Comments'}
      aria-pressed={active}
      className={`${className} grid place-items-center transition shrink-0 relative ${
        isBar
          ? active
            ? 'border-l border-lime bg-lime text-primary-foreground'
            : 'border-l border-border text-muted-foreground hover:border-lime hover:text-lime hover:bg-surface/60'
          : active
            ? 'border border-lime bg-lime text-primary-foreground'
            : 'border border-border bg-surface-2 text-muted-foreground hover:border-lime hover:text-lime'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M2.5 3.5h11a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H9.2L7 13.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      {!isBar && !active && showCount && count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-lime text-primary-foreground text-[8px] font-bold leading-[14px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}

export function MobileMixerVersionBar({
  versions, activeId, onSelect, onNewBranch,
  onRenameVersion, onDeleteVersion,
  commentMode, commentCount, onToggleCommentMode,
  switchOnly = false,
  versionSwitchDisabled = false,
}: {
  versions: Version[]
  activeId: string
  onSelect: (id: string) => void
  onNewBranch?: () => void
  onRenameVersion?: (id: string, name: string) => void
  onDeleteVersion?: (id: string) => void
  commentMode?: boolean
  commentCount?: number
  onToggleCommentMode?: () => void
  /** Rehearsal — scrollable version switcher only, no branch/comment actions. */
  switchOnly?: boolean
  versionSwitchDisabled?: boolean
}) {
  const sortedVersions = useMemo(() => sortMobileVersions(versions), [versions])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const activeVersion = versions.find(v => v.id === activeId)

  function startRename(v: Version) {
    if (!onRenameVersion || v.type === 'main') return
    setRenamingId(v.id)
    setRenameValue(v.name)
    setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select() }, 0)
  }

  function commitRename() {
    const id = renamingId
    setRenamingId(null)
    if (!id) return
    const trimmed = renameValue.trim()
    if (trimmed) onRenameVersion?.(id, trimmed)
  }

  return (
    <div className={`flex items-stretch shrink-0 h-10 ${switchOnly ? 'bg-background' : 'border-b border-border bg-surface/40'}`}>
      <div className={`flex-1 min-w-0 overflow-x-auto flex flex-nowrap items-center gap-1.5 scrollbar-none [&::-webkit-scrollbar]:hidden ${switchOnly ? 'px-0' : 'px-2'}`}>
        {sortedVersions.map(v => {
          const isActive = v.id === activeId
          const switchBlocked = versionSwitchDisabled && !isActive
          const isRenaming = renamingId === v.id

          if (isRenaming) {
            return (
              <input
                key={v.id}
                ref={renameInputRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value.slice(0, 60))}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                className="shrink-0 text-[10px] uppercase tracking-widest px-2 py-1 border border-lime bg-background text-foreground max-w-[160px] outline-none"
              />
            )
          }

          return (
            <button
              key={v.id}
              type="button"
              disabled={switchBlocked}
              onClick={() => {
                // Tapping the already-active branch again opens rename — mirrors
                // the "tap selected section again" pattern in the structure editor.
                if (isActive && v.type === 'branch' && onRenameVersion) startRename(v)
                else onSelect(v.id)
              }}
              className={`shrink-0 text-[10px] uppercase tracking-widest px-2 py-1 border transition overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px] ${
                isActive
                  ? 'bg-lime text-primary-foreground border-lime'
                  : switchBlocked
                    ? 'border-border text-muted-foreground opacity-40 cursor-not-allowed'
                    : v.merged_at
                      ? 'border-border text-muted-foreground opacity-50'
                      : 'border-border hover:border-lime hover:text-lime text-muted-foreground'
              }`}
            >
              {v.type === 'main' && '● '}
              {v.merged_at && '✓ '}
              {v.type === 'branch' && !v.merged_at && '⌥ '}
              <VersionListName version={v} />
            </button>
          )
        })}
      </div>
      {!switchOnly && onNewBranch && (
        <button
          type="button"
          onClick={onNewBranch}
          className="shrink-0 self-stretch border-l border-border px-2.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime hover:bg-surface/60 transition"
        >
          + Version
        </button>
      )}
      {!switchOnly && onDeleteVersion && activeVersion?.type === 'branch' && (
        <button
          type="button"
          onClick={() => onDeleteVersion(activeVersion.id)}
          aria-label="Delete version"
          className="shrink-0 self-stretch border-l border-destructive px-2.5 text-destructive hover:bg-destructive/10 transition"
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1.5 3h9M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M10 3l-.75 7.5a.5.5 0 0 1-.5.5h-5.5a.5.5 0 0 1-.5-.5L2 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {!switchOnly && onToggleCommentMode && (
        <CommentToggleBtn
          active={commentMode ?? false}
          count={commentCount ?? 0}
          onClick={onToggleCommentMode}
          variant="bar"
          showCount={false}
          tourId="mobile-mixer-comments"
          className="shrink-0 self-stretch w-10"
        />
      )}
    </div>
  )
}

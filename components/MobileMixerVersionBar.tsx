'use client'

import { useMemo } from 'react'
import type { Version } from '@/lib/types'
import { sortMobileVersions } from '@/lib/versionSort'

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
            ? 'border-l border-ember bg-ember text-white'
            : 'border-l border-border text-muted-foreground hover:border-ember hover:text-ember hover:bg-surface/60'
          : active
            ? 'border border-ember bg-ember text-white'
            : 'border border-border bg-surface-2 text-muted-foreground hover:border-ember hover:text-ember'
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
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-ember text-white text-[8px] font-bold leading-[14px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}

export function MobileMixerVersionBar({
  versions, activeId, onSelect, onNewBranch,
  commentMode, commentCount, onToggleCommentMode,
}: {
  versions: Version[]
  activeId: string
  onSelect: (id: string) => void
  onNewBranch: () => void
  commentMode: boolean
  commentCount: number
  onToggleCommentMode: () => void
}) {
  const sortedVersions = useMemo(() => sortMobileVersions(versions), [versions])

  return (
    <div className="flex items-stretch border-b border-border bg-surface/40 shrink-0 h-10">
      <div className="flex-1 min-w-0 overflow-x-auto flex items-center gap-1.5 px-2 scrollbar-none">
        {sortedVersions.map(v => {
          const isActive = v.id === activeId
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              className={`shrink-0 text-[10px] uppercase tracking-widest px-2 py-1 border transition ${
                isActive
                  ? 'bg-ember text-white border-ember'
                  : v.merged_at
                    ? 'border-border text-muted-foreground opacity-50'
                    : 'border-border hover:border-ember hover:text-ember text-muted-foreground'
              }`}
            >
              {v.type === 'main' && '● '}
              {v.merged_at && '✓ '}
              {v.type === 'branch' && !v.merged_at && '⌥ '}
              {v.name}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onNewBranch}
        className="shrink-0 self-stretch border-l border-border px-2.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember hover:bg-surface/60 transition"
      >
        + Branch
      </button>
      <CommentToggleBtn
        active={commentMode}
        count={commentCount}
        onClick={onToggleCommentMode}
        variant="bar"
        showCount={false}
        tourId="mobile-mixer-comments"
        className="shrink-0 self-stretch w-10"
      />
    </div>
  )
}

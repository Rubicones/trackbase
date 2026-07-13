'use client'

import { useState, type ReactNode } from 'react'
import type { TrackComment, CommentReply } from '@/lib/types'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { UserAvatar } from '@/components/ui/avatar'

// ─── Local helpers ────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

const fmtMs = (ms: number) => fmtTime(ms / 1000)

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function TrashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Comment tooltip (portal) ─────────────────────────────────────────────────
// The single source of truth for how a track comment looks when hovered —
// used by the mixer and by the cherry-pick diff view.

export function CommentTooltip({
  comment, anchorLeft, anchorTop, onDelete, onHide, onShow, currentUserId, isOwner, onReplySubmit, onReplyFocusChange,
  projectOffsetMs = 0,
  readOnly = false,
  statusBadge,
  footer,
}: {
  comment: TrackComment
  anchorLeft: number
  anchorTop: number
  onDelete?: (id: string) => void
  onHide: () => void
  onShow?: () => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplySubmit?: (commentId: string, content: string) => Promise<void>
  onReplyFocusChange?: (focused: boolean) => void
  /** Added to track-relative timecodes for project-timeline display. */
  projectOffsetMs?: number
  /** Hides delete + reply input (e.g. diff preview contexts). */
  readOnly?: boolean
  /** Extra badge rendered next to the timecode (e.g. NEW / DEL in diffs). */
  statusBadge?: ReactNode
  /** Extra action row rendered at the bottom (e.g. include/skip in diffs). */
  footer?: ReactNode
}) {
  const W = 260
  let left = anchorLeft - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  const [showAllReplies, setShowAllReplies] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const replies: CommentReply[] = (comment.replies ?? []) as CommentReply[]
  const visibleReplies = showAllReplies ? replies : replies.slice(0, 2)
  const hiddenCount = replies.length - 2

  const canDelete = !readOnly && !!onDelete && (comment.created_by === currentUserId || isOwner)
  const author = comment.author_username ?? 'unknown'

  return (
    <FloatingPopover left={left} top={anchorTop} width={W} transform="translateY(4px)" onMouseLeave={onHide} onMouseEnter={onShow}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <UserAvatar seed={author} size={18} kind="user" />
          <span className="text-[11px] text-foreground truncate">{author}</span>
          <span className="text-[10px] tabular-nums text-lime shrink-0">
            {fmtMs(comment.timecode_start_ms + projectOffsetMs)} → {fmtMs(comment.timecode_end_ms + projectOffsetMs)}
          </span>
          {statusBadge}
          {canDelete && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete?.(comment.id) }}
              className="ml-auto text-muted-foreground hover:text-destructive transition-colors grid place-items-center size-6 shrink-0"
              aria-label="Delete comment"
            >
              <TrashIcon />
            </button>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground m-0 mb-2">{relativeTime(comment.created_at)}</p>
        <p className="text-[13px] text-foreground leading-snug break-words m-0">{comment.content}</p>

        {replies.length > 0 && (
          <div className="border-t border-border mt-2 pt-2 space-y-2">
            {visibleReplies.map(r => (
              <div key={r.id}>
                <div className="flex items-center gap-2 mb-0.5">
                  <UserAvatar seed={r.author_username} size={16} kind="user" />
                  <span className="text-[11px] text-foreground">{r.author_username}</span>
                </div>
                <p className="text-[12px] text-foreground/85 leading-snug m-0">{r.content}</p>
                <p className="text-[9px] text-muted-foreground m-0 mt-0.5">{relativeTime(r.created_at)}</p>
              </div>
            ))}
            {!showAllReplies && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllReplies(true)}
                className="text-[10px] uppercase tracking-widest text-lime hover:underline"
              >
                Show {hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        )}

        {!readOnly && onReplySubmit && (
          <div className={`border-t border-border pt-2 ${replies.length > 0 ? 'mt-2' : 'mt-3'}`}>
            <input
              placeholder="Reply..."
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onPointerDown={e => {
                e.stopPropagation()
                onReplyFocusChange?.(true)
              }}
              onFocus={() => onReplyFocusChange?.(true)}
              onBlur={() => { setTimeout(() => onReplyFocusChange?.(false), 150) }}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onKeyDown={async e => {
                if (e.key === 'Enter' && !e.shiftKey && replyText.trim() && !submittingReply) {
                  e.preventDefault()
                  setSubmittingReply(true)
                  try { await onReplySubmit(comment.id, replyText.trim()); setReplyText('') }
                  catch { /* ignore */ }
                  finally { setSubmittingReply(false) }
                }
              }}
              className="flex h-8 w-full font-display border border-border bg-transparent px-3 py-1 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        )}

        {footer && (
          <div className="border-t border-border mt-2 pt-2">
            {footer}
          </div>
        )}
      </div>
    </FloatingPopover>
  )
}

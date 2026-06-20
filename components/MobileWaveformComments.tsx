'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { UserAvatar } from '@/components/ui/avatar'
import type { CommentReply, TrackComment } from '@/lib/types'
import { useMobileTimelineScroll } from '@/components/MobileTimelineScrollSync'

export interface MobileActiveCommentInput {
  trackId: string
  startMs: number
  endMs: number
  startXPercent: number
  endXPercent: number
  waveformTop: number
  waveformLeft: number
  waveformWidth: number
  waveformHeight: number
}

function fmtTime(secs: number): string {
  const s = Math.floor(secs)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

const fmtMs = (ms: number) => fmtTime(ms / 1000)

function CommentTrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function computeOverlapOffsets(comments: TrackComment[]): Map<string, number> {
  const sorted = [...comments].sort((a, b) => a.timecode_start_ms - b.timecode_start_ms)
  const offsets = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]
    let offset = 0
    for (let j = 0; j < i; j++) {
      const prev = sorted[j]
      if (c.timecode_start_ms < prev.timecode_end_ms) {
        offset = (offsets.get(prev.id) ?? 0) + 8
      }
    }
    offsets.set(c.id, offset)
  }
  return offsets
}

function isCommentUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-comment-ui]') !== null
}

function CommentTooltip({
  comment, anchorLeft, anchorTop, onDelete, onHide, currentUserId, isOwner, onReplySubmit,
}: {
  comment: TrackComment
  anchorLeft: number
  anchorTop: number
  onDelete: (id: string) => void
  onHide: () => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplySubmit: (commentId: string, content: string) => Promise<void>
}) {
  const W = 260
  let left = anchorLeft - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const replies: CommentReply[] = (comment.replies ?? []) as CommentReply[]
  const canDelete = comment.created_by === currentUserId || isOwner
  const author = comment.author_username ?? 'unknown'

  return (
    <FloatingPopover left={left} top={anchorTop} width={W} onMouseLeave={onHide}>
      <div className="px-3 py-2.5" data-comment-ui>
        <div className="flex items-center gap-2 mb-1">
          <UserAvatar seed={author} size={18} kind="user" />
          <span className="text-[11px] text-foreground truncate">{author}</span>
          <span className="text-[10px] tabular-nums text-ember shrink-0">
            {fmtMs(comment.timecode_start_ms)} → {fmtMs(comment.timecode_end_ms)}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDelete(comment.id) }}
              className="ml-auto text-muted-foreground hover:text-destructive transition-colors grid place-items-center size-6 shrink-0"
              aria-label="Delete comment"
            >
              <CommentTrashIcon />
            </button>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground m-0 mb-2">{relativeTime(comment.created_at)}</p>
        <p className="text-[13px] text-foreground leading-snug break-words m-0">{comment.content}</p>
        {replies.length > 0 && (
          <div className="border-t border-border mt-2 pt-2 space-y-2">
            {replies.slice(0, 3).map(r => (
              <div key={r.id}>
                <div className="flex items-center gap-2 mb-0.5">
                  <UserAvatar seed={r.author_username} size={16} kind="user" />
                  <span className="text-[11px] text-foreground">{r.author_username}</span>
                </div>
                <p className="text-[12px] text-foreground/85 leading-snug m-0">{r.content}</p>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-border mt-2 pt-2 flex gap-2">
          <input
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Reply…"
            className="flex-1 h-7 border border-border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={e => {
              if (e.key === 'Enter' && replyText.trim() && !submittingReply) {
                void (async () => {
                  setSubmittingReply(true)
                  try {
                    await onReplySubmit(comment.id, replyText.trim())
                    setReplyText('')
                  } finally {
                    setSubmittingReply(false)
                  }
                })()
              }
            }}
          />
        </div>
      </div>
    </FloatingPopover>
  )
}

function CommentRangeMarker({
  comment, durationMs, commentMode, onDelete, currentUserId, isOwner, onReplyCreate,
}: {
  comment: TrackComment
  durationMs: number
  commentMode: boolean
  onDelete: (id: string) => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
}) {
  const startPct = durationMs > 0 ? (comment.timecode_start_ms / durationMs) * 100 : 0
  const endPct = durationMs > 0 ? (comment.timecode_end_ms / durationMs) * 100 : 0
  const widthPct = Math.max(endPct - startPct, 0)
  const isNarrow = widthPct < 3
  const [showTooltip, setShowTooltip] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showTooltip || commentMode) return
    function onDoc(e: PointerEvent) {
      const t = e.target as Node
      if (rangeRef.current?.contains(t)) return
      if (isCommentUiTarget(e.target)) return
      setShowTooltip(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [showTooltip, commentMode])

  function getAnchor() {
    const r = rangeRef.current?.getBoundingClientRect()
    if (!r) return { left: 0, top: 0 }
    return isNarrow
      ? { left: r.left, top: r.top }
      : { left: r.left + r.width / 2, top: r.top }
  }

  return (
    <div
      ref={rangeRef}
      style={{
        left: `${startPct}%`,
        width: `${widthPct}%`,
        pointerEvents: commentMode ? 'none' : 'auto',
        minWidth: isNarrow ? 20 : 2,
      }}
      className="absolute top-0 h-full z-[3] pointer-events-auto"
      data-comment-ui
      onClick={e => {
        if (commentMode) return
        e.stopPropagation()
        setShowTooltip(v => !v)
      }}
    >
      <div className="absolute inset-0 waveform-accent-fill" style={{ opacity: showTooltip ? 1 : 0.55 }} />
      <div className="absolute top-0 bottom-0 left-0 w-px waveform-accent-edge" style={{ opacity: showTooltip ? 1 : 0.5 }} />
      <div className="absolute top-0 bottom-0 right-0 w-px waveform-accent-edge" style={{ opacity: showTooltip ? 1 : 0.5 }} />
      {showTooltip && (() => {
        const { left, top } = getAnchor()
        return (
          <CommentTooltip
            comment={comment}
            anchorLeft={left}
            anchorTop={top}
            onDelete={onDelete}
            onHide={() => setShowTooltip(false)}
            currentUserId={currentUserId}
            isOwner={isOwner}
            onReplySubmit={onReplyCreate}
          />
        )
      })()}
    </div>
  )
}

function CommentInputBubble({
  input, onSubmit, onClose, currentUser,
}: {
  input: MobileActiveCommentInput
  onSubmit: (content: string) => Promise<void>
  onClose: () => void
  currentUser: { username: string } | null
}) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 20) }, [])
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = ('touches' in e
        ? document.elementFromPoint(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0)
        : e.target) as Node | null
      if (bubbleRef.current && t && !bubbleRef.current.contains(t)) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose])

  async function submit() {
    if (!text.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(text.trim())
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const W = 248
  const { waveformLeft, waveformWidth, waveformTop, startXPercent, endXPercent, startMs, endMs } = input
  const centerPct = (startXPercent + endXPercent) / 2
  const lineX = waveformLeft + centerPct * waveformWidth
  let left = lineX - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  return (
    <FloatingPopover left={left} top={waveformTop - 8} width={W}>
      <div ref={bubbleRef} className="p-3" data-comment-ui>
        {currentUser && (
          <div className="flex items-center gap-2 mb-2">
            <UserAvatar seed={currentUser.username} size={16} kind="user" />
            <span className="text-[11px] text-foreground">{currentUser.username}</span>
          </div>
        )}
        <div className="text-[10px] tabular-nums text-ember mb-2">
          {fmtMs(startMs)} → {fmtMs(endMs)}
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit() }}
          placeholder="Add comment..."
          className="flex h-8 w-full border border-border bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex justify-end mt-2 pt-2 border-t border-border">
          <Button size="sm" onClick={() => void submit()} disabled={submitting || !text.trim()} className="text-[10px] h-7">
            {submitting ? '…' : 'Send'}
          </Button>
        </div>
      </div>
    </FloatingPopover>
  )
}

const EDGE_ZONE_PX = 44
const EDGE_SCROLL_STEP = 10

export function MobileWaveformComments({
  trackId,
  durationMs,
  comments,
  commentMode,
  activeInput,
  timelineRef,
  scrollRef,
  onCommentPlace,
  onCommentDelete,
  onCommentCreate,
  onCloseInput,
  onReplyCreate,
  currentUserId,
  isOwner,
  currentUser,
}: {
  trackId: string
  durationMs: number
  comments: TrackComment[]
  commentMode: boolean
  activeInput: MobileActiveCommentInput | null
  timelineRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  onCommentPlace: (input: MobileActiveCommentInput) => void
  onCommentDelete: (id: string) => void
  onCommentCreate: (trackId: string, startMs: number, endMs: number, content: string) => Promise<void>
  onCloseInput: () => void
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  currentUserId: string | undefined
  isOwner: boolean
  currentUser: { username: string } | null
}) {
  const scrollSync = useMobileTimelineScroll()
  const dragRef = useRef<{ active: boolean; startPct: number; currentPct: number; clientX: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ startX: number; endX: number } | null>(null)
  const edgeScrollRaf = useRef<number | null>(null)

  const getXPercent = useCallback((clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [timelineRef])

  const finalizeRange = useCallback(() => {
    const dr = dragRef.current
    if (!dr?.active) return
    dr.active = false
    setDragRect(null)
    dragRef.current = null
    if (edgeScrollRaf.current) {
      cancelAnimationFrame(edgeScrollRaf.current)
      edgeScrollRaf.current = null
    }

    const { startPct, currentPct } = dr
    if (Math.abs(currentPct - startPct) < 0.01) return
    if (durationMs <= 0) return

    const minPct = Math.min(startPct, currentPct)
    const maxPct = Math.max(startPct, currentPct)
    const startMs = Math.round(minPct * durationMs)
    const endMs = Math.max(startMs + 1, Math.round(maxPct * durationMs))
    const rect = timelineRef.current!.getBoundingClientRect()
    onCommentPlace({
      trackId,
      startMs,
      endMs,
      startXPercent: minPct,
      endXPercent: maxPct,
      waveformTop: rect.top,
      waveformLeft: rect.left,
      waveformWidth: rect.width,
      waveformHeight: rect.height,
    })
  }, [durationMs, onCommentPlace, trackId, timelineRef])

  const stopEdgeScroll = useCallback(() => {
    if (edgeScrollRaf.current) {
      cancelAnimationFrame(edgeScrollRaf.current)
      edgeScrollRaf.current = null
    }
  }, [])

  const runEdgeScroll = useCallback((clientX: number) => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const bounds = scrollEl.getBoundingClientRect()
    let delta = 0
    if (clientX > bounds.right - EDGE_ZONE_PX) delta = EDGE_SCROLL_STEP
    else if (clientX < bounds.left + EDGE_ZONE_PX) delta = -EDGE_SCROLL_STEP

    if (delta !== 0) {
      const next = Math.max(0, Math.min(scrollEl.scrollWidth - scrollEl.clientWidth, scrollEl.scrollLeft + delta))
      scrollEl.scrollLeft = next
      scrollSync?.syncTo(next, scrollEl)
    }

    if (dragRef.current?.active) {
      const pct = getXPercent(clientX)
      dragRef.current.currentPct = pct
      dragRef.current.clientX = clientX
      setDragRect({ startX: dragRef.current.startPct, endX: pct })
      edgeScrollRaf.current = requestAnimationFrame(() => runEdgeScroll(clientX))
    }
  }, [getXPercent, scrollRef, scrollSync])

  const handleDragMove = useCallback((clientX: number) => {
    if (!commentMode || !dragRef.current?.active) return
    dragRef.current.clientX = clientX
    const pct = getXPercent(clientX)
    dragRef.current.currentPct = pct
    setDragRect({ startX: dragRef.current.startPct, endX: pct })
    stopEdgeScroll()
    runEdgeScroll(clientX)
  }, [commentMode, getXPercent, runEdgeScroll, stopEdgeScroll])

  useEffect(() => {
    const handler = () => finalizeRange()
    window.addEventListener('mouseup', handler)
    window.addEventListener('touchend', handler)
    return () => {
      window.removeEventListener('mouseup', handler)
      window.removeEventListener('touchend', handler)
      stopEdgeScroll()
    }
  }, [finalizeRange, stopEdgeScroll])

  function handleDragStart(clientX: number) {
    if (!commentMode) return
    const pct = getXPercent(clientX)
    dragRef.current = { active: true, startPct: pct, currentPct: pct, clientX }
    setDragRect({ startX: pct, endX: pct })
  }

  const overlapOffsets = computeOverlapOffsets(comments)
  const thisInputActive = activeInput?.trackId === trackId
  const dragSpan = dragRect ? Math.abs(dragRect.endX - dragRect.startX) : 0

  if (!commentMode && comments.length === 0 && !thisInputActive) return null

  return (
    <div className="absolute inset-0 z-[5] pointer-events-none">
      {commentMode && (
        <div
          className="absolute inset-0 pointer-events-auto"
          style={{ touchAction: 'none' }}
          onMouseDown={e => { e.preventDefault(); handleDragStart(e.clientX) }}
          onMouseMove={e => handleDragMove(e.clientX)}
          onTouchStart={e => { e.preventDefault(); handleDragStart(e.touches[0].clientX) }}
          onTouchMove={e => { e.preventDefault(); handleDragMove(e.touches[0].clientX) }}
        >
          {!dragRect && (
            <div className="absolute inset-0 pointer-events-none bg-ember/5 border border-dashed border-ember/40 grid place-items-center">
              <div className="text-[8px] uppercase tracking-widest text-ember bg-background/90 border border-ember/40 px-1.5 py-0.5">
                Tap & drag
              </div>
            </div>
          )}
        </div>
      )}

      {comments.map(c => (
        <CommentRangeMarker
          key={c.id}
          comment={c}
          durationMs={durationMs}
          commentMode={commentMode}
          onDelete={onCommentDelete}
          currentUserId={currentUserId}
          isOwner={isOwner}
          onReplyCreate={onReplyCreate}
        />
      ))}

      {commentMode && dragRect !== null && dragSpan > 0 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none waveform-accent-fill z-[4]"
          style={{
            left: `${Math.min(dragRect.startX, dragRect.endX) * 100}%`,
            width: `${dragSpan * 100}%`,
          }}
        />
      )}

      {thisInputActive && activeInput && (
        <CommentInputBubble
          input={activeInput}
          onSubmit={content => onCommentCreate(trackId, activeInput.startMs, activeInput.endMs, content)}
          onClose={onCloseInput}
          currentUser={currentUser}
        />
      )}
    </div>
  )
}

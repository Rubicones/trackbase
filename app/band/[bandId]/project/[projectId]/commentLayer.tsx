'use client'

// Waveform comment UI (markers, toggle button, input bubble) — extracted verbatim from page.tsx.
import React, { useEffect, useRef, useState } from 'react'
import type { TrackComment } from '@/lib/types'
import { CommentTooltip } from '@/components/CommentTooltip'
import { FloatingPopover } from '@/components/design/FloatingPopover'
import { UserAvatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { fmtMs } from './mixerUtils'
import type { ActiveCommentInput } from './mixerTypes'

// ─── Comment tooltip (extracted to components/CommentTooltip.tsx) ────────────

export function isCommentUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-comment-ui]') !== null
}

// ─── Comment toggle (icon button for mobile top bar) ─────────────────────────

export function CommentToggleBtn({
  active, count, onClick, className = 'size-8',
}: {
  active: boolean
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour="comments-toggle"
      aria-label={active ? 'Exit comment mode' : `Comments${count > 0 ? ` (${count})` : ''}`}
      aria-pressed={active}
      className={`${className} border grid place-items-center transition shrink-0 relative ${
        active
          ? 'border-lime bg-lime text-primary-foreground'
          : 'border-border bg-surface-2 text-muted-foreground hover:border-lime hover:text-lime'
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
      {!active && count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-lime text-primary-foreground text-[8px] font-bold leading-[14px] text-center">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}


export function CommentRangeMarker({ comment, durationMs, commentMode, onDelete, currentUserId, isOwner, onReplyCreate, onInteractionChange, projectOffsetMs = 0 }: {
  comment: TrackComment
  durationMs: number
  commentMode: boolean
  onDelete: (id: string) => void
  currentUserId: string | undefined
  isOwner: boolean
  onReplyCreate: (commentId: string, content: string) => Promise<void>
  onInteractionChange?: (commentId: string, active: boolean) => void
  projectOffsetMs?: number
}) {
  const startPct = durationMs > 0 ? (comment.timecode_start_ms / durationMs) * 100 : 0
  const endPct = durationMs > 0 ? (comment.timecode_end_ms / durationMs) * 100 : 0
  const widthPct = Math.max(endPct - startPct, 0)
  const isNarrow = widthPct < 3

  const [showTooltip, setShowTooltip] = useState(false)
  const [replyFocused, setReplyFocused] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tooltipVisible = showTooltip || replyFocused

  useEffect(() => {
    onInteractionChange?.(comment.id, tooltipVisible)
    return () => onInteractionChange?.(comment.id, false)
  }, [tooltipVisible, comment.id, onInteractionChange])

  const scheduleHide = () => {
    hideTimer.current = setTimeout(() => {
      if (!replyFocused) setShowTooltip(false)
    }, 120)
  }
  const cancelHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current) }

  function getAnchor() {
    const r = rangeRef.current?.getBoundingClientRect()
    if (!r) return { left: 0, top: 0 }
    return isNarrow
      ? { left: r.left, top: r.bottom }
      : { left: r.left + r.width / 2, top: r.bottom }
  }

  // Tap outside to close on touch devices
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

  function handleMarkerTap(e: React.MouseEvent) {
    if (commentMode) return
    // Desktop uses hover; touch devices toggle on tap
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) return
    e.stopPropagation()
    setShowTooltip(v => !v)
  }

  return (
    <div
      ref={rangeRef}
      className="absolute top-0 h-full z-[3]"
      data-comment-ui
      style={{
        left: `${startPct}%`,
        width: `${widthPct}%`,
        pointerEvents: commentMode ? 'none' : 'auto',
        minWidth: isNarrow ? 20 : 2,
      }}
      onMouseEnter={() => { if (!commentMode) { cancelHide(); setShowTooltip(true) } }}
      onMouseLeave={scheduleHide}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onClick={handleMarkerTap}
    >
      {/* Range fill */}
      <div
        className="absolute inset-0 transition-colors duration-150 waveform-accent-fill"
        style={{ opacity: tooltipVisible ? 1 : 0.55 }}
      />
      {/* Left edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 waveform-accent-edge"
        style={{ left: 0, width: 1.5, opacity: tooltipVisible ? 1.0 : 0.5 }}
      />
      {/* Right edge line */}
      <div
        className="absolute top-0 bottom-0 pointer-events-none transition-opacity duration-150 waveform-accent-edge"
        style={{ right: 0, width: 1.5, opacity: tooltipVisible ? 1.0 : 0.5 }}
      />
      {tooltipVisible && (() => {
        const { left, top } = getAnchor()
        return (
          <CommentTooltip
            comment={comment}
            anchorLeft={left}
            anchorTop={top}
            onDelete={onDelete}
            onHide={scheduleHide}
            onShow={cancelHide}
            currentUserId={currentUserId}
            isOwner={isOwner}
            onReplySubmit={onReplyCreate}
            onReplyFocusChange={(focused) => setReplyFocused(focused)}
            projectOffsetMs={projectOffsetMs}
          />
        )
      })()}
    </div>
  )
}

// ─── Comment input bubble (portal) ────────────────────────────────────────────

export function CommentInputBubble({ input, onSubmit, onClose, currentUser }: {
  input: ActiveCommentInput
  onSubmit: (content: string) => Promise<void>
  onClose: () => void
  currentUser: { username: string } | null
}) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errored, setErrored] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 20) }, [])
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = ('touches' in e ? document.elementFromPoint(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0) : e.target) as Node | null
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
    try { await onSubmit(text.trim()); onClose() }
    catch { setErrored(true); setTimeout(() => setErrored(false), 1000) }
    finally { setSubmitting(false) }
  }

  const W = 248
  const { waveformLeft, waveformWidth, waveformTop, waveformHeight, startXPercent, endXPercent, startMs, endMs } = input
  const centerPct = (startXPercent + endXPercent) / 2
  const lineX = waveformLeft + centerPct * waveformWidth

  // Center bubble over range, clamp to viewport
  let left = lineX - W / 2
  if (left < 8) left = 8
  if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8

  return (
    <FloatingPopover left={left} top={waveformTop + waveformHeight} width={W} transform="translateY(4px)">
      <div ref={bubbleRef} className="p-3">
        {currentUser && (
          <div className="flex items-center gap-2 mb-2">
            <UserAvatar seed={currentUser.username} size={16} kind="user" />
            <span className="text-[11px] text-foreground">{currentUser.username}</span>
          </div>
        )}
        <div className="text-[10px] tabular-nums text-lime mb-2">
          {fmtMs(startMs)} → {fmtMs(endMs)}
        </div>
        <input
          ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose() }}
          placeholder="Add comment..."
          className="flex h-8 w-full font-display border border-border bg-transparent px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-border">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">esc to cancel</span>
          <Button
            size="sm"
            onClick={submit}
            disabled={submitting || !text.trim()}
            className="uppercase tracking-widest text-[10px] font-bold h-7"
          >
            {submitting ? '…' : errored ? 'Error' : 'Send'}
          </Button>
        </div>
      </div>
    </FloatingPopover>
  )
}

'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserAvatar } from '@/components/ui/avatar'
import { SpinnerBars } from '@/components/ui/Spinner'
import { trackEvent } from '@/lib/analytics'
import {
  BAND_CHANNEL,
  findActiveMention,
  formatTimecodeRange,
  formatMessageTime,
  groupMessages,
  insertMention,
  parseMessageTokens,
  type BandMessage,
  type ChannelKey,
} from '@/lib/chat'
import { useBandChat, type ChatMember } from '@/components/chat/useBandChat'
import { useMobileKeyboardInset } from '@/hooks/useMobileKeyboardInset'
import { IconBranch, IconNote } from '@/components/chat/ContextIcons'
import { getVersionDisplayName } from '@/lib/versionSort'
import { VersionListName } from '@/components/VersionListName'

// ─── Inline icons (match the app's lightweight SVG convention) ─────────────────

function IconChat({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H9.2L7 13.5V11H2.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

/** Inline chat trigger for mobile toolbars (band tabs, rehearsal/mixer row). */
export function ChatLauncherButton({
  unread = 0,
  onClick,
  className = '',
  variant = 'icon',
}: {
  unread?: number
  onClick: () => void
  className?: string
  /** icon = square toolbar button; bar = full-width strip above mode switch */
  variant?: 'icon' | 'bar'
}) {
  if (variant === 'bar') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Open band chat"
        className={`relative w-full flex items-center justify-center gap-2 py-2.5 border border-border bg-background text-[10px] font-bold uppercase tracking-[0.28em] text-foreground hover:text-lime hover:bg-surface/60 transition ${className}`}
      >
        <IconChat size={14} />
        Chat
        {unread > 0 && (
          <span className="min-w-[16px] h-4 px-1 grid place-items-center bg-lime text-primary-foreground text-[9px] font-bold leading-none">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open band chat"
      className={`relative grid place-items-center border border-border bg-background text-foreground hover:border-lime hover:text-lime transition ${className}`}
    >
      <IconChat size={14} />
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center border border-background bg-lime px-1 text-[9px] font-bold text-white">
          {Math.min(unread, 99)}
        </span>
      )}
    </button>
  )
}
function IconClose({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconSend({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 8l12-5-5 12-2.5-4.5L2 8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
function IconClock({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function IconPlus({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function IconArrowDown({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 2v8M2.5 6.5L6 10l3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconChevron({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Types for popover data ────────────────────────────────────────────────────

interface PopoverVersion {
  id: string
  name: string
  type: 'main' | 'branch'
  tracks: { id: string; display_name: string | null; name: string }[]
}

interface Attach {
  versionId?: string
  versionName?: string
  trackId?: string
  trackName?: string
}

// ─── Main dock ──────────────────────────────────────────────────────────────────

export function ChatDock({
  bandId,
  open,
  onOpen,
  onClose,
  initialChannelKey,
  currentUserId,
  currentProjectId,
  onSwitchVersion,
  onUnreadChange,
}: {
  bandId: string
  open: boolean
  onOpen: () => void
  onClose: () => void
  initialChannelKey?: ChannelKey
  currentUserId: string | undefined
  /** When open from the mixer, used to switch branch in-place on chip click. */
  currentProjectId?: string
  onSwitchVersion?: (versionId: string) => void
  onUnreadChange?: (total: number) => void
}) {
  const router = useRouter()
  const {
    projects,
    members,
    channelKey,
    setChannelKey,
    messages,
    loadingMessages,
    loadingOlder,
    hasMore,
    loadOlder,
    counts,
    branchCounts,
    unread,
    onlineUserIds,
    send,
  } = useBandChat({ bandId, open, currentUserId, initialChannelKey })

  const [draft, setDraft] = useState('')
  const [attach, setAttach] = useState<Attach>({})
  const [openPopover, setOpenPopover] = useState<'branch' | 'track' | null>(null)
  const [activeMention, setActiveMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionPickIdx, setMentionPickIdx] = useState(0)

  const projectVersionsCacheRef = useRef<Map<string, PopoverVersion[]>>(new Map())
  const projectVersionsInflightRef = useRef<Map<string, Promise<PopoverVersion[]>>>(new Map())

  const loadProjectVersions = useCallback(async (projectId: string): Promise<PopoverVersion[]> => {
    const cached = projectVersionsCacheRef.current.get(projectId)
    if (cached) return cached

    const inflight = projectVersionsInflightRef.current.get(projectId)
    if (inflight) return inflight

    const promise = fetch(`/api/projects/${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => (data?.versions ?? []) as PopoverVersion[])
      .catch(() => [] as PopoverVersion[])
      .then(versions => {
        projectVersionsCacheRef.current.set(projectId, versions)
        projectVersionsInflightRef.current.delete(projectId)
        return versions
      })

    projectVersionsInflightRef.current.set(projectId, promise)
    return promise
  }, [])

  const getCachedProjectVersions = useCallback(
    (projectId: string) => projectVersionsCacheRef.current.get(projectId),
    [],
  )

  useEffect(() => {
    if (open) return
    projectVersionsCacheRef.current.clear()
    projectVersionsInflightRef.current.clear()
  }, [open])

  const asideRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const channelStripRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const prevLastIdRef = useRef<string | null>(null)
  const prevFirstIdRef = useRef<string | null>(null)
  const prevChannelRef = useRef<ChannelKey | null>(null)
  const prevOpenRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const savedPageScrollRef = useRef(0)
  const [showNewIndicator, setShowNewIndicator] = useState(false)
  const { keyboardInset } = useMobileKeyboardInset(open)

  const isBandChannel = channelKey === BAND_CHANNEL
  const activeProject = useMemo(
    () => projects.find(p => p.id === channelKey),
    [projects, channelKey],
  )
  const channelName = isBandChannel ? 'band' : (activeProject?.name?.toLowerCase() ?? 'project')

  const memberHandles = useMemo(
    () => new Set(members.map(m => m.username.toLowerCase())),
    [members],
  )

  const mentionCandidates = useMemo(() => {
    if (!activeMention) return []
    const q = activeMention.query.toLowerCase()
    return members
      .filter(m =>
        m.username.toLowerCase().includes(q) ||
        (m.display_name?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 8)
  }, [activeMention, members])

  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0)

  useEffect(() => {
    onUnreadChange?.(totalUnread)
  }, [totalUnread, onUnreadChange])

  useEffect(() => {
    if (open && !prevOpenRef.current) trackEvent('chat_opened')
    prevOpenRef.current = open
  }, [open])

  // Vertical wheel → horizontal scroll on channel tabs (no shift needed).
  useEffect(() => {
    const el = channelStripRef.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  // Snap page to top on mobile so fixed chat aligns with shell header/footer.
  useLayoutEffect(() => {
    if (!open) return

    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    if (!isMobile) return

    savedPageScrollRef.current = window.scrollY
    window.scrollTo(0, 0)

    const prevBodyOverflow = document.body.style.overflow
    const prevHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = prevBodyOverflow
      document.documentElement.style.overflow = prevHtmlOverflow
      window.scrollTo(0, savedPageScrollRef.current)
    }
  }, [open])

  // Trap scroll inside the dock — never scroll the page behind it.
  useEffect(() => {
    if (!open) return

    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    const aside = asideRef.current
    if (!aside) return
    const onWheel = (e: WheelEvent) => {
      let el = e.target as Element | null
      while (el && el !== aside) {
        if (el instanceof HTMLElement) {
          const { overflowY, overflowX } = getComputedStyle(el)
          const canScrollY =
            (overflowY === 'auto' || overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight
          const canScrollX =
            (overflowX === 'auto' || overflowX === 'scroll') &&
            el.scrollWidth > el.clientWidth
          if (canScrollY) {
            const atTop = el.scrollTop <= 0
            const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
            if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return
            break
          }
          if (canScrollX && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            const atLeft = el.scrollLeft <= 0
            const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
            if ((e.deltaY < 0 && !atLeft) || (e.deltaY > 0 && !atRight)) return
            break
          }
        }
        el = el.parentElement
      }
      e.preventDefault()
      e.stopPropagation()
    }

    const isScrollableInsideAside = (target: EventTarget | null) => {
      let el = target as Element | null
      while (el && el !== aside) {
        if (el instanceof HTMLTextAreaElement) return true
        if (el instanceof HTMLElement) {
          const { overflowY, overflowX } = getComputedStyle(el)
          const canScrollY =
            (overflowY === 'auto' || overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight
          const canScrollX =
            (overflowX === 'auto' || overflowX === 'scroll') &&
            el.scrollWidth > el.clientWidth
          if (canScrollY || canScrollX) return true
        }
        el = el.parentElement
      }
      return false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (aside.contains(e.target as Node) && isScrollableInsideAside(e.target)) return
      e.preventDefault()
    }

    aside.addEventListener('wheel', onWheel, { passive: false })
    if (isMobile) {
      document.addEventListener('touchmove', onTouchMove, { passive: false })
    }
    return () => {
      aside.removeEventListener('wheel', onWheel)
      if (isMobile) {
        document.removeEventListener('touchmove', onTouchMove)
      }
    }
  }, [open])

  function updateDraft(value: string, cursor: number) {
    setDraft(value)
    setActiveMention(findActiveMention(value, cursor))
    setMentionPickIdx(0)
  }

  function pickMention(member: ChatMember) {
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? draft.length
    if (!activeMention) return
    const next = insertMention(draft, cursor, activeMention.start, member.username)
    setDraft(next.text)
    setActiveMention(null)
    setMentionPickIdx(0)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(next.cursor, next.cursor)
    })
  }

  // Clear composer + chips when switching channels.
  useEffect(() => {
    setAttach({})
    setOpenPopover(null)
    setDraft('')
    setActiveMention(null)
  }, [channelKey])

  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setShowNewIndicator(false)
  }

  // Auto-scroll on new messages (if at bottom); preserve position on prepend.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || messages.length === 0) {
      prevLastIdRef.current = null
      prevFirstIdRef.current = null
      return
    }
    const firstId = messages[0].id
    const lastId = messages[messages.length - 1].id
    const channelChanged = prevChannelRef.current !== channelKey

    if (channelChanged) {
      el.scrollTop = el.scrollHeight
      setShowNewIndicator(false)
    } else if (prevFirstIdRef.current && firstId !== prevFirstIdRef.current && lastId === prevLastIdRef.current) {
      // Prepend (older page) — keep the viewport anchored.
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current
    } else if (prevLastIdRef.current && lastId !== prevLastIdRef.current) {
      // Append (incoming) — follow if already at bottom, else flag it.
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
      else setShowNewIndicator(true)
    }

    prevChannelRef.current = channelKey
    prevFirstIdRef.current = firstId
    prevLastIdRef.current = lastId
  }, [messages, channelKey])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (atBottomRef.current) setShowNewIndicator(false)
    if (el.scrollTop < 80 && hasMore && !loadingOlder) {
      prevScrollHeightRef.current = el.scrollHeight
      loadOlder()
    }
  }, [hasMore, loadingOlder, loadOlder])

  function switchChannel(next: ChannelKey) {
    if (next !== channelKey) {
      trackEvent('chat_channel_switched', { channel: next === BAND_CHANNEL ? 'band' : 'project' })
    }
    setChannelKey(next)
  }

  function submit() {
    const text = draft.trim()
    if (!text) return
    send(text, {
      context_version_id: attach.versionId ?? null,
      context_track_id: attach.trackId ?? null,
    })
    setDraft('')
    setAttach({})
    setOpenPopover(null)
    setActiveMention(null)
    atBottomRef.current = true
  }

  function navigateToChip(m: BandMessage) {
    const projectId = m.context_project_id ?? m.channel_id
    if (!projectId) return

    if (projectId === currentProjectId && m.context_version_id && onSwitchVersion) {
      onSwitchVersion(m.context_version_id)
      return
    }

    const qs = new URLSearchParams()
    if (m.context_version_id) qs.set('v', m.context_version_id)
    if (m.context_track_id) qs.set('t', m.context_track_id)
    const query = qs.toString()
    router.push(`/band/${bandId}/project/${projectId}${query ? `?${query}` : ''}`)
    onClose()
  }

  const groups = useMemo(() => groupMessages(messages), [messages])
  const onlineMembers = members.filter(m => onlineUserIds.has(m.user_id))

  return (
    <>
      {/* Mobile FAB removed — pages embed ChatLauncherButton in their own chrome */}

      <button
        type="button"
        onClick={onOpen}
        aria-label="Open chat panel"
        data-tour="chat-launcher"
        className={`fixed right-0 top-1/2 z-[300] hidden -translate-y-1/2 lg:flex flex-col items-center gap-3 border-l border-y border-border bg-surface/60 hover:bg-surface px-1.5 py-4 transition ${
          open ? 'opacity-0 pointer-events-none' : ''
        }`}
      >
        <span className="text-muted-foreground rotate-180"><IconChevron /></span>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground"
          style={{ writingMode: 'vertical-rl' }}
        >
          Chat
        </span>
        {totalUnread > 0 && (
          <span className="grid h-4 min-w-4 place-items-center bg-lime px-1 text-[9px] font-bold text-white">
            {Math.min(totalUnread, 99)}
          </span>
        )}
        {onlineMembers.length > 0 && (
          <span className="flex flex-col items-center -space-y-1 mt-1">
            {onlineMembers.slice(0, 4).map(m => (
              <span key={m.user_id} className="relative" title={`@${m.username} · online`}>
                <UserAvatar seed={m.username} size={20} kind="user" />
                <span className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full bg-online border border-background" />
              </span>
            ))}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Scrim — mobile opaque, desktop transparent (outside-click to close) */}
          <div
            className="chat-dock-scrim fixed inset-0 z-[250] bg-background lg:z-[305] lg:bg-transparent"
            style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
            onClick={onClose}
            aria-hidden
          />

          <aside
            ref={asideRef}
            className="chat-dock-aside flex flex-col bg-background border-border overscroll-none lg:fixed lg:border-l"
            style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
            role="dialog"
            aria-label="Band chat"
          >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface/40 px-6 h-11 shrink-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-foreground min-w-0">
            <span className="text-lime"><IconChat /></span>
            <span>Chat</span>
            {onlineMembers.length > 0 && (
              <span className="flex items-center -space-x-1 ml-1">
                {onlineMembers.slice(0, 4).map(m => (
                  <span key={m.user_id} className="relative" title={`@${m.username} · online`}>
                    <UserAvatar seed={m.username} size={18} kind="user" />
                    <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-online border border-background" />
                  </span>
                ))}
                {onlineMembers.length > 4 && (
                  <span className="text-muted-foreground pl-1.5 tabular-nums">+{onlineMembers.length - 4}</span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close chat"
            className="size-7 grid place-items-center text-muted-foreground hover:text-foreground transition"
          >
            <IconClose />
          </button>
        </div>

        {/* Channel tab strip */}
        <div
          ref={channelStripRef}
          className="border-b border-border bg-background overflow-x-auto scrollbar-none shrink-0 touch-pan-x overscroll-x-contain"
        >
          <div className="flex">
            <ChannelTab
              active={isBandChannel}
              label="# band"
              hint={`${members.length} members · ${counts[BAND_CHANNEL] ?? 0}M`}
              unread={isBandChannel ? 0 : unread[BAND_CHANNEL] ?? 0}
              onClick={() => switchChannel(BAND_CHANNEL)}
            />
            {projects.map(p => (
              <ChannelTab
                key={p.id}
                active={channelKey === p.id}
                label={`# ${p.name.toLowerCase()}`}
                hint={`${branchCounts[p.id] ?? p.version_count ?? 0}B · ${counts[p.id] ?? 0}M`}
                unread={channelKey === p.id ? 0 : unread[p.id] ?? 0}
                onClick={() => switchChannel(p.id)}
              />
            ))}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain scrollbar-none px-6 py-3 space-y-3 relative">
          {loadingOlder && (
            <div className="flex justify-center py-1" role="status" aria-label="Loading older messages">
              <SpinnerBars />
            </div>
          )}
          {loadingMessages && (
            <div className="flex justify-center pt-10" role="status" aria-label="Loading messages">
              <SpinnerBars />
            </div>
          )}
          {!loadingMessages && messages.length === 0 && (
            <div className="text-muted-foreground text-center pt-10 text-[10px] uppercase tracking-widest">
              No messages in this channel yet
            </div>
          )}
          {!loadingMessages && groups.map((g, gi) => (
            <MessageGroupView
              key={`${g.user_id}-${gi}-${g.items[0].id}`}
              group={g}
              memberHandles={memberHandles}
              onChipClick={navigateToChip}
            />
          ))}
        </div>

        {/* New-messages indicator */}
        {showNewIndicator && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 border border-lime bg-lime text-primary-foreground px-3 py-1 text-[9px] font-bold uppercase tracking-widest shadow-lg"
          >
            <IconArrowDown /> New messages
          </button>
        )}

        {/* Attached chips */}
        {(attach.versionId || attach.trackId) && (
          <div className="bg-surface/40 px-6 py-2 flex flex-wrap items-center gap-2 text-[10px] font-mono shrink-0">
            <span className="text-muted-foreground uppercase tracking-widest">Attached:</span>
            {attach.versionId && (
              <span className="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5">
                <span className="text-lime"><IconBranch /></span>
                {attach.versionName}
                <button onClick={() => setAttach(a => ({ ...a, versionId: undefined, versionName: undefined }))} aria-label="Remove version" className="ml-0.5 text-muted-foreground hover:text-foreground">
                  <IconClose size={10} />
                </button>
              </span>
            )}
            {attach.trackId && (
              <span className="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5">
                <IconNote />
                {attach.trackName}
                <button onClick={() => setAttach(a => ({ ...a, trackId: undefined, trackName: undefined }))} aria-label="Remove track" className="ml-0.5 text-muted-foreground hover:text-foreground">
                  <IconClose size={10} />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={e => { e.preventDefault(); submit() }}
          className="border-t border-border bg-surface/40 shrink-0"
          style={{
            paddingBottom: keyboardInset === 0 ? 'max(0.5rem, env(safe-area-inset-bottom))' : undefined,
          }}
        >
          {!isBandChannel && (
            <div className="relative flex items-center gap-1 px-6 pt-2">
              <ComposerChip
                icon={<IconBranch />}
                label="version"
                active={!!attach.versionId}
                onClick={() => setOpenPopover(p => (p === 'branch' ? null : 'branch'))}
              />
              <ComposerChip
                icon={<IconNote />}
                label="track"
                active={!!attach.trackId}
                onClick={() => setOpenPopover(p => (p === 'track' ? null : 'track'))}
              />

              {openPopover && activeProject && (
                <ContextPopover
                  projectId={activeProject.id}
                  mode={openPopover}
                  selectedVersionId={attach.versionId}
                  getCachedVersions={getCachedProjectVersions}
                  loadVersions={loadProjectVersions}
                  onClose={() => setOpenPopover(null)}
                  onPickVersion={(id, name) => {
                    setAttach(a => ({ ...a, versionId: id, versionName: name }))
                    setOpenPopover(null)
                  }}
                  onPickTrack={(id, name) => {
                    setAttach(a => ({ ...a, trackId: id, trackName: name }))
                    setOpenPopover(null)
                  }}
                />
              )}
            </div>
          )}
          <div className="relative flex items-end gap-2 px-6 py-2">
            {activeMention && mentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-6 right-6 mb-1 z-50 max-h-40 overflow-y-auto scrollbar-none border border-border bg-surface-2 shadow-2xl">
                {mentionCandidates.map((m, i) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pickMention(m) }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition ${
                      i === mentionPickIdx ? 'bg-lime-soft text-lime' : 'hover:bg-surface'
                    }`}
                  >
                    <UserAvatar seed={m.username} size={20} kind="user" />
                    <span className="font-bold text-lime">@{m.username}</span>
                    {m.display_name && (
                      <span className="text-muted-foreground truncate">{m.display_name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={e => updateDraft(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onClick={e => {
                const ta = e.currentTarget
                setActiveMention(findActiveMention(draft, ta.selectionStart ?? draft.length))
              }}
              onKeyDown={e => {
                if (activeMention && mentionCandidates.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionPickIdx(i => (i + 1) % mentionCandidates.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionPickIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    pickMention(mentionCandidates[mentionPickIdx])
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setActiveMention(null)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
              }}
              rows={1}
              placeholder={`Message #${channelName}… (@ to mention)`}
              className="flex-1 resize-none bg-background border border-border px-2 py-1.5 text-xs outline-none focus:border-lime max-h-24"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="grid h-8 w-8 shrink-0 place-items-center border border-lime bg-lime text-primary-foreground transition disabled:opacity-40 disabled:bg-surface-2 disabled:text-muted-foreground disabled:border-border"
            >
              <IconSend />
            </button>
          </div>
        </form>
          </aside>
        </>
      )}
    </>
  )
}

// ─── Channel tab ──────────────────────────────────────────────────────────────

function ChannelTab({
  active, label, hint, unread, onClick,
}: {
  active: boolean
  label: string
  hint: string
  unread: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 max-w-[9rem] px-3 h-10 text-left border-b-2 transition ${
        active ? 'border-lime bg-lime-soft/40' : 'border-transparent hover:bg-surface/60'
      }`}
    >
      <div className={`text-[10px] font-bold uppercase tracking-widest leading-none truncate ${active ? 'text-lime' : 'text-foreground'}`}>
        {label}
      </div>
      <div className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground mt-0.5 truncate">{hint}</div>
      {unread > 0 && (
        <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-lime text-primary-foreground text-[8px] font-bold leading-[14px] text-center">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}

// ─── Composer chip button ──────────────────────────────────────────────────────

function ComposerChip({
  icon, label, active, disabled, onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-widest transition ${
        active
          ? 'border-lime bg-lime-soft text-lime'
          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground'
      } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:border-border`}
    >
      {icon}
      {label}
      {!active && !disabled && <span className="opacity-60"><IconPlus /></span>}
    </button>
  )
}

// ─── Branch / track popover (uses session cache while chat is open) ─────────────

function ContextPopover({
  projectId, mode, selectedVersionId, getCachedVersions, loadVersions, onClose, onPickVersion, onPickTrack,
}: {
  projectId: string
  mode: 'branch' | 'track'
  selectedVersionId?: string
  getCachedVersions: (projectId: string) => PopoverVersion[] | undefined
  loadVersions: (projectId: string) => Promise<PopoverVersion[]>
  onClose: () => void
  onPickVersion: (id: string, name: string) => void
  onPickTrack: (id: string, name: string) => void
}) {
  const [versions, setVersions] = useState<PopoverVersion[] | null>(
    () => getCachedVersions(projectId) ?? null,
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const cached = getCachedVersions(projectId)
    if (cached) {
      setVersions(cached)
      return
    }
    let cancelled = false
    setVersions(null)
    loadVersions(projectId).then(data => {
      if (!cancelled) setVersions(data)
    })
    return () => { cancelled = true }
  }, [projectId, getCachedVersions, loadVersions])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  const trackVersion =
    mode === 'track'
      ? versions?.find(v => v.id === selectedVersionId) ?? versions?.find(v => v.type === 'main') ?? versions?.[0]
      : undefined
  const tracks = trackVersion?.tracks ?? []

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-2 mb-1 z-50 w-56 max-h-64 overflow-y-auto scrollbar-none border border-border bg-surface-2 shadow-2xl"
    >
      <div className="px-2 py-1.5 border-b border-border text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {mode === 'branch' ? 'Attach version' : `Attach track${trackVersion ? ` · ${getVersionDisplayName(trackVersion)}` : ''}`}
      </div>
      {versions === null && (
        <div className="flex justify-center py-3" role="status" aria-label="Loading branches and tracks">
          <SpinnerBars />
        </div>
      )}
      {mode === 'branch' && versions?.map(v => (
        <button
          key={v.id}
          type="button"
          onClick={() => onPickVersion(v.id, getVersionDisplayName(v))}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface transition"
        >
          <span className="text-lime"><IconBranch /></span>
          <VersionListName version={v} className="truncate" />
          {v.type === 'main' && <span className="ml-auto text-[8px] uppercase tracking-widest text-muted-foreground">Master</span>}
        </button>
      ))}
      {mode === 'track' && versions !== null && tracks.length === 0 && (
        <div className="px-2 py-3 text-[10px] text-muted-foreground text-center">No tracks</div>
      )}
      {mode === 'track' && tracks.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPickTrack(t.id, t.display_name || t.name)}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-surface transition"
        >
          <IconNote />
          <span className="truncate">{t.display_name || t.name}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Message group ──────────────────────────────────────────────────────────────

function MessageGroupView({
  group, memberHandles, onChipClick,
}: {
  group: ReturnType<typeof groupMessages>[number]
  memberHandles: Set<string>
  onChipClick: (m: BandMessage) => void
}) {
  return (
    <div className="flex gap-2.5">
      <UserAvatar seed={group.author_username} size={28} kind="user" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-[10px] leading-none">
          <span className="font-bold text-lime">@{group.author_username}</span>
          <span className="text-muted-foreground tabular-nums font-mono">{formatMessageTime(group.items[0].created_at)}</span>
        </div>
        <div className="mt-1 space-y-1.5">
          {group.items.map((m, i) => (
            <MessageBubble
              key={m.id}
              m={m}
              memberHandles={memberHandles}
              hoverTime={i > 0 ? formatMessageTime(m.created_at) : undefined}
              onChipClick={onChipClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  m, memberHandles, hoverTime, onChipClick,
}: {
  m: BandMessage
  memberHandles: Set<string>
  hoverTime?: string
  onChipClick: (m: BandMessage) => void
}) {
  const tokens = parseMessageTokens(m.content)
  const timeRange = formatTimecodeRange(
    m.context_timecode_start_ms,
    m.context_timecode_end_ms,
  )
  const hasChips = m.context_version_id || m.context_track_id || timeRange
  const showTrack = !!m.context_track_name
  const showTime = !!timeRange

  return (
    <div className="group/msg relative text-[12px] leading-relaxed text-foreground">
      {hoverTime && (
        <span className="absolute left-[-2.6rem] top-0.5 w-9 text-right text-[8px] font-mono tabular-nums text-muted-foreground opacity-0 group-hover/msg:opacity-100 transition">
          {hoverTime}
        </span>
      )}
      <div>
        {tokens.map((tok, i) =>
          tok.type === 'mention' ? (
            <span
              key={i}
              className={`font-bold ${
                memberHandles.has(tok.handle.toLowerCase())
                  ? 'text-lime bg-lime-soft/50 px-0.5'
                  : 'text-muted-foreground'
              }`}
              title={`@${tok.handle}`}
            >
              {tok.value}
            </span>
          ) : (
            <span key={i} className="whitespace-pre-wrap">{tok.value}</span>
          ),
        )}
      </div>
      {hasChips && (
        <button
          type="button"
          onClick={() => onChipClick(m)}
          className="mt-1 inline-flex max-w-full items-stretch border border-border bg-surface text-[10px] font-mono hover:border-lime transition overflow-hidden"
        >
          {m.context_version_name && (
            <span className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5${showTrack || showTime ? ' border-r border-border' : ''}`}>
              <span className="text-lime"><IconBranch /></span>
              <span className="max-w-[4.5rem] truncate">{m.context_version_name}</span>
            </span>
          )}
          {m.context_track_name && (
            <span className={`inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 max-w-[9rem] overflow-hidden${showTime ? ' border-r border-border' : ''}`}>
              <span className="shrink-0"><IconNote /></span>
              <span className="truncate">{m.context_track_name}</span>
            </span>
          )}
          {timeRange && (
            <span className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 tabular-nums text-muted-foreground whitespace-nowrap">
              <span className="shrink-0"><IconClock /></span>
              <span>{timeRange}</span>
            </span>
          )}
        </button>
      )}
    </div>
  )
}

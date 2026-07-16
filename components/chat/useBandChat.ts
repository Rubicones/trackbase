'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { trackEvent } from '@/lib/analytics'
import { getSupabaseClient } from '@/lib/supabase/client'
import { syncSupabaseRealtimeAuth } from '@/lib/supabase/realtime-auth'
import {
  BAND_CHANNEL,
  channelIdOf,
  channelKeyOf,
  extractMentions,
  type BandMessage,
  type ChannelKey,
} from '@/lib/chat'
import { fetchBandData } from '@/lib/bandDataCache'

export interface ChatChannelProject {
  id: string
  name: string
  version_count: number
}

export interface ChatMember {
  user_id: string
  username: string
  display_name: string | null
  avatar_color: string | null
  role: string
}

export interface SendOptions {
  context_version_id?: string | null
  context_track_id?: string | null
  context_timecode_start_ms?: number | null
  context_timecode_end_ms?: number | null
}

interface UseBandChatArgs {
  bandId: string
  open: boolean
  currentUserId: string | undefined
  initialChannelKey?: ChannelKey
}

function readStoredReads(bandId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(`tb-chat-read-${bandId}`) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function writeStoredReads(bandId: string, reads: Record<string, string>) {
  try {
    localStorage.setItem(`tb-chat-read-${bandId}`, JSON.stringify(reads))
  } catch {
    /* ignore quota / disabled storage */
  }
}

/**
 * Owns all band-chat data + realtime wiring for the dock:
 *  - loads channels (projects) + members
 *  - lists / paginates messages for the active channel
 *  - subscribes to new messages (live) and routes them by channel
 *  - tracks unread badges (localStorage last-read timestamps)
 *  - tracks online presence while the panel is open
 */
export function useBandChat({ bandId, open, currentUserId, initialChannelKey }: UseBandChatArgs) {
  const supabase = getSupabaseClient()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<ChatChannelProject[]>([])
  const [members, setMembers] = useState<ChatMember[]>([])

  const [channelKey, setChannelKey] = useState<ChannelKey>(initialChannelKey ?? BAND_CHANNEL)
  const [messages, setMessages] = useState<BandMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  const [counts, setCounts] = useState<Record<string, number>>({})
  const [branchCounts, setBranchCounts] = useState<Record<string, number>>({})
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())

  // Refs the realtime handler reads so it always sees current state.
  const activeKeyRef = useRef<ChannelKey | null>(null)
  const messageIdsRef = useRef<Set<string>>(new Set())
  const readsRef = useRef<Record<string, string>>({})
  const markReadRef = useRef<(key: ChannelKey) => void>(() => {})
  const currentUserIdRef = useRef(currentUserId)
  const lastCreatedAtRef = useRef<string | null>(null)
  currentUserIdRef.current = currentUserId

  /** Band channel shows every message; project channels are filtered. */
  const messageMatchesActiveChannel = useCallback((active: ChannelKey | null, messageKey: ChannelKey) => {
    if (!active) return false
    if (active === BAND_CHANNEL) return true
    return active === messageKey
  }, [])

  const appendMessage = useCallback((message: BandMessage) => {
    if (messageIdsRef.current.has(message.id)) return
    messageIdsRef.current.add(message.id)
    lastCreatedAtRef.current = message.created_at
    setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]))
  }, [])

  const bumpCounts = useCallback((channelId: string | null) => {
    setCounts(prev => ({
      ...prev,
      band: (prev.band ?? 0) + 1,
      ...(channelId ? { [channelId]: (prev[channelId] ?? 0) + 1 } : {}),
    }))
  }, [])

  // ── Load channels + members ──
  // Shares /api/bands/[id] with the band page via fetchBandData (cache + in-flight dedupe).
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    readsRef.current = readStoredReads(bandId)
    async function load() {
      try {
        const data = await fetchBandData(bandId, controller.signal)
        if (cancelled) return

        const projectRows =
          (data.projects as { id: string; name: string; version_count?: number }[] | undefined) ?? []
        const memberRows =
          (data.members as {
            user_id: string
            role: string
            profiles: { username: string; display_name: string | null; avatar_color: string | null } | null
          }[] | undefined) ?? []

        setProjects(
          projectRows.map(p => ({
            id: p.id,
            name: p.name,
            version_count: Number(p.version_count) || 0,
          })),
        )
        setMembers(
          memberRows.map(m => ({
            user_id: m.user_id,
            username: m.profiles?.username ?? 'unknown',
            display_name: m.profiles?.display_name ?? null,
            avatar_color: m.profiles?.avatar_color ?? null,
            role: m.role,
          })),
        )
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [bandId])

  // ── Per-channel message counts (refreshed when the panel opens) ──
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/bands/${bandId}/messages?counts=1`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return
        if (data.counts) setCounts(data.counts)
        if (data.branchCounts) setBranchCounts(data.branchCounts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [bandId, open])

  // ── Mark a channel read (clears its unread badge) ──
  const markRead = useCallback(
    (key: ChannelKey) => {
      readsRef.current = { ...readsRef.current, [key]: new Date().toISOString() }
      writeStoredReads(bandId, readsRef.current)
      setUnread(prev => (prev[key] ? { ...prev, [key]: 0 } : prev))
    },
    [bandId],
  )
  markReadRef.current = markRead

  // ── Load the active channel's latest messages ──
  useEffect(() => {
    activeKeyRef.current = open ? channelKey : null
    if (!open) return
    let cancelled = false
    setMessages([])
    messageIdsRef.current = new Set()
    lastCreatedAtRef.current = null
    setHasMore(false)
    setLoadingMessages(true)
    const channelParam = channelIdOf(channelKey) ?? 'band'
    fetch(`/api/bands/${bandId}/messages?channel=${channelParam}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data) return
        const asc: BandMessage[] = (data.messages ?? []).slice().reverse()
        setMessages(asc)
        messageIdsRef.current = new Set(asc.map(m => m.id))
        lastCreatedAtRef.current = asc[asc.length - 1]?.created_at ?? null
        setHasMore(Boolean(data.hasMore))
        markRead(channelKey)
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false)
      })
    return () => {
      cancelled = true
    }
  }, [bandId, channelKey, open, markRead])

  // ── Infinite scroll upward: load 50 older messages ──
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const channelParam = channelIdOf(channelKey) ?? 'band'
      const before = messages[0].created_at
      const res = await fetch(
        `/api/bands/${bandId}/messages?channel=${channelParam}&before=${encodeURIComponent(before)}`,
      )
      if (!res.ok) return
      const data = await res.json()
      const olderAsc: BandMessage[] = (data.messages ?? []).slice().reverse()
      const fresh = olderAsc.filter(m => !messageIdsRef.current.has(m.id))
      for (const m of fresh) messageIdsRef.current.add(m.id)
      setMessages(prev => [...fresh, ...prev])
      setHasMore(Boolean(data.hasMore))
    } finally {
      setLoadingOlder(false)
    }
  }, [bandId, channelKey, hasMore, loadingOlder, messages])

  // ── Realtime: new messages (kept alive while mounted to power unread) ──
  useEffect(() => {
    if (!bandId) return
    let active = true
    let channel: RealtimeChannel | null = null

    const handleInsert = (row: { id: string; channel_id: string | null; user_id: string }) => {
      if (messageIdsRef.current.has(row.id)) return

      const key = channelKeyOf(row.channel_id)
      bumpCounts(row.channel_id)

      const viewing = activeKeyRef.current
      if (messageMatchesActiveChannel(viewing, key)) {
        fetch(`/api/bands/${bandId}/messages?message=${row.id}`)
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (d?.message) {
              appendMessage(d.message)
              if (viewing) markReadRef.current(viewing)
            }
          })
          .catch(() => {})
      } else if (row.user_id !== currentUserIdRef.current) {
        setUnread(prev => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
      }
    }

    async function subscribe() {
      await syncSupabaseRealtimeAuth()
      if (!active) return

      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
      if (!active) return

      channel = supabase
        .channel(`band-chat-${bandId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'band_messages', filter: `band_id=eq.${bandId}` },
          payload => {
            handleInsert(
              payload.new as { id: string; channel_id: string | null; user_id: string },
            )
          },
        )
        .subscribe(status => {
          if (!active) return
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Retry once auth/session may have landed after first mount.
            window.setTimeout(() => {
              if (active) void subscribe()
            }, 2000)
          }
        })
    }

    void subscribe()

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && active) {
        void syncSupabaseRealtimeAuth(session.access_token).then(() => {
          if (active) void subscribe()
        })
      }
    })

    return () => {
      active = false
      authListener.subscription.unsubscribe()
      if (channel) supabase.removeChannel(channel)
    }
  }, [bandId, supabase, appendMessage, bumpCounts, messageMatchesActiveChannel])

  // ── Poll for new messages while the panel is open (fallback if Realtime is down) ──
  useEffect(() => {
    if (!open) return
    let cancelled = false

    const poll = async () => {
      const after = lastCreatedAtRef.current
      if (!after) return
      const channelParam = channelIdOf(channelKey) ?? 'band'
      try {
        const res = await fetch(
          `/api/bands/${bandId}/messages?channel=${channelParam}&after=${encodeURIComponent(after)}`,
        )
        if (!res.ok || cancelled) return
        const data = await res.json()
        const incoming = (data.messages ?? []) as BandMessage[]
        if (incoming.length === 0) return

        const viewing = activeKeyRef.current
        for (const message of incoming) {
          if (messageMatchesActiveChannel(viewing, channelKeyOf(message.channel_id))) {
            appendMessage(message)
          }
        }
        if (viewing) markReadRef.current(viewing)
      } catch {
        /* ignore transient network errors */
      }
    }

    void poll()
    const interval = window.setInterval(poll, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [open, bandId, channelKey, appendMessage, messageMatchesActiveChannel])

  // ── Realtime presence ──
  // Observe who's in the chat for the whole mount (so the closed rail can show
  // online members), but only broadcast our own presence while the panel is open.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const presenceChannelRef = useRef<RealtimeChannel | null>(null)
  useEffect(() => {
    if (!bandId || !currentUserId) {
      setOnlineUserIds(new Set())
      return
    }
    const channel = supabase.channel(`band-presence-${bandId}`, {
      config: { presence: { key: currentUserId } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineUserIds(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe(async status => {
        if (status === 'SUBSCRIBED' && openRef.current) {
          await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() })
        }
      })
    presenceChannelRef.current = channel
    return () => {
      presenceChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [bandId, currentUserId, supabase])

  // Enter / leave presence as the panel opens / closes.
  useEffect(() => {
    const channel = presenceChannelRef.current
    if (!channel || !currentUserId) return
    if (open) {
      channel.track({ user_id: currentUserId, online_at: new Date().toISOString() })
    } else {
      channel.untrack()
    }
  }, [open, currentUserId])

  // ── Send a message — append immediately from the API response; realtime is a backup ──
  const send = useCallback(
    async (content: string, opts: SendOptions = {}) => {
      const trimmed = content.trim()
      if (!trimmed) return
      const res = await fetch(`/api/bands/${bandId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channelIdOf(channelKey),
          content: trimmed,
          ...opts,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      const message = data.message as BandMessage | undefined
      if (!message) return

      trackEvent('chat_message_sent', {
        has_mention: extractMentions(trimmed).length > 0,
        has_version_chip: Boolean(opts.context_version_id),
        has_track_chip: Boolean(opts.context_track_id),
      })

      bumpCounts(message.channel_id)
      if (messageMatchesActiveChannel(activeKeyRef.current, channelKeyOf(message.channel_id))) {
        appendMessage(message)
        if (activeKeyRef.current) markReadRef.current(activeKeyRef.current)
      }
    },
    [bandId, channelKey, appendMessage, bumpCounts, messageMatchesActiveChannel],
  )

  return {
    loading,
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
  }
}

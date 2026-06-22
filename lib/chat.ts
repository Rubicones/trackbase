// ─── Band chat types & helpers ─────────────────────────────────────────────────

export type BandMessageType = 'message' | 'track_comment'

/** A chat message enriched with author + context-chip display data by the API. */
export interface BandMessage {
  id: string
  band_id: string
  channel_id: string | null // null = band-wide channel
  user_id: string
  content: string
  type: BandMessageType

  context_version_id: string | null
  context_track_id: string | null
  context_timecode_start_ms: number | null
  context_timecode_end_ms: number | null

  source_track_comment_id: string | null
  created_at: string

  // ── enriched (joined) fields ──
  author_username: string
  author_avatar_color: string | null
  context_version_name: string | null
  context_track_name: string | null
  // project that owns the context version/track — for navigation + bar math
  context_project_id: string | null
  context_project_bpm: number | null
  context_project_time_signature: string | null
}

/** Channel key used for routing + localStorage. `null` channel_id → 'band'. */
export type ChannelKey = string
export const BAND_CHANNEL: ChannelKey = 'band'

export function channelKeyOf(channelId: string | null): ChannelKey {
  return channelId ?? BAND_CHANNEL
}

/** Convert a channel key back to the channel_id column value. */
export function channelIdOf(key: ChannelKey): string | null {
  return key === BAND_CHANNEL ? null : key
}

// ─── Bar conversion ─────────────────────────────────────────────────────────

/** Beats-per-bar from a time signature string like '4/4' (defaults to 4). */
export function beatsPerBar(timeSignature: string | null | undefined): number {
  const num = parseInt((timeSignature ?? '4/4').split('/')[0] ?? '4', 10)
  return Number.isFinite(num) && num > 0 ? num : 4
}

/** 1-indexed bar number for a timecode (ms) given project BPM + time signature. */
export function msToBar(
  ms: number,
  bpm: number | null | undefined,
  timeSignature: string | null | undefined,
): number {
  const safeBpm = bpm && bpm > 0 ? bpm : 120
  const beatMs = 60000 / safeBpm
  const barMs = beatMs * beatsPerBar(timeSignature)
  if (barMs <= 0) return 1
  return Math.floor(ms / barMs) + 1
}

/** Formats a stored timecode (ms) as M:SS. */
export function formatTimecodeMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Formats a context time chip range, e.g. "1:23" or "1:23–2:45". */
export function formatTimecodeRange(
  startMs: number | null,
  endMs: number | null,
): string | null {
  if (startMs == null) return null
  const start = formatTimecodeMs(startMs)
  if (endMs == null) return start
  const end = formatTimecodeMs(endMs)
  return end !== start ? `${start}–${end}` : start
}

/** Formats a context time chip's bar range, e.g. "bar 5" or "bar 5–8". */
export function formatBarRange(
  startMs: number | null,
  endMs: number | null,
  bpm: number | null | undefined,
  timeSignature: string | null | undefined,
): string | null {
  if (startMs == null) return null
  const start = msToBar(startMs, bpm, timeSignature)
  if (endMs == null) return `bar ${start}`
  const end = msToBar(endMs, bpm, timeSignature)
  return end > start ? `bar ${start}–${end}` : `bar ${start}`
}

// ─── Timestamps ───────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** HH:MM for same-day messages; "MMM D · HH:MM" for older ones. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (sameDay) return hhmm
  const date = d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return `${date} · ${hhmm}`
}

// ─── @mention parsing ───────────────────────────────────────────────────────

const MENTION_RE = /(@\w+)/g

export type MessageToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; handle: string }

/** Split message content into plain-text and @mention tokens for rendering. */
export function parseMessageTokens(content: string): MessageToken[] {
  const tokens: MessageToken[] = []
  let lastIndex = 0
  for (const match of content.matchAll(MENTION_RE)) {
    const idx = match.index ?? 0
    if (idx > lastIndex) {
      tokens.push({ type: 'text', value: content.slice(lastIndex, idx) })
    }
    tokens.push({ type: 'mention', value: match[0], handle: match[0].slice(1) })
    lastIndex = idx + match[0].length
  }
  if (lastIndex < content.length) {
    tokens.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return tokens
}

/** Unique @handles referenced in the message text. */
export function extractMentions(content: string): string[] {
  const out = new Set<string>()
  for (const match of content.matchAll(MENTION_RE)) out.add(match[0].slice(1))
  return [...out]
}

/** Active @mention being typed at the cursor, if any. */
export function findActiveMention(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const match = before.match(/@([a-zA-Z0-9_]*)$/)
  if (!match) return null
  return { start: cursor - match[0].length, query: match[1] }
}

/** Insert a completed @mention at the active position. */
export function insertMention(
  text: string,
  cursor: number,
  mentionStart: number,
  username: string,
): { text: string; cursor: number } {
  const before = text.slice(0, mentionStart)
  const after = text.slice(cursor)
  const token = `@${username} `
  return { text: before + token + after, cursor: before.length + token.length }
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

const GROUP_WINDOW_MS = 2 * 60 * 1000

export interface MessageGroup {
  user_id: string
  author_username: string
  author_avatar_color: string | null
  items: BandMessage[]
}

/**
 * Group consecutive messages from the same author sent within 2 minutes.
 * Input must be in ascending chronological order.
 */
export function groupMessages(messages: BandMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    const lastItem = last?.items[last.items.length - 1]
    const withinWindow =
      lastItem &&
      new Date(m.created_at).getTime() - new Date(lastItem.created_at).getTime() <
        GROUP_WINDOW_MS
    if (last && last.user_id === m.user_id && withinWindow) {
      last.items.push(m)
    } else {
      groups.push({
        user_id: m.user_id,
        author_username: m.author_username,
        author_avatar_color: m.author_avatar_color,
        items: [m],
      })
    }
  }
  return groups
}

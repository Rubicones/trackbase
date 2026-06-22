import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { extractMentions, type BandMessage } from '@/lib/chat'

const PAGE_SIZE = 50

// Raw band_messages columns selected from the DB.
const MESSAGE_COLUMNS =
  'id, band_id, channel_id, user_id, content, type, context_version_id, context_track_id, context_timecode_start_ms, context_timecode_end_ms, source_track_comment_id, created_at'

type RawMessage = {
  id: string
  band_id: string
  channel_id: string | null
  user_id: string
  content: string
  type: string
  context_version_id: string | null
  context_track_id: string | null
  context_timecode_start_ms: number | null
  context_timecode_end_ms: number | null
  source_track_comment_id: string | null
  created_at: string
}

/** Verify the requester is a member of the band; returns userId or an error. */
async function requireBandMembership(
  req: NextRequest,
  bandId: string,
): Promise<{ userId: string } | { error: string; status: number }> {
  const userId = await getRequestUserId(req)
  if (!userId) return { error: 'Unauthorized', status: 401 }

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return { error: 'Not found', status: 404 }

  return { userId }
}

/** Attach author + context-chip display data to raw message rows. */
async function enrichMessages(rows: RawMessage[]): Promise<BandMessage[]> {
  if (rows.length === 0) return []

  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))]
  const versionIds = [...new Set(rows.map(r => r.context_version_id).filter(Boolean))] as string[]
  const trackIds = [...new Set(rows.map(r => r.context_track_id).filter(Boolean))] as string[]

  const [profilesRes, versionsRes, tracksRes] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, username, avatar_color').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; username: string; avatar_color: string | null }[] }),
    versionIds.length
      ? supabase.from('versions').select('id, name, project_id').in('id', versionIds)
      : Promise.resolve({ data: [] as { id: string; name: string; project_id: string }[] }),
    trackIds.length
      ? supabase.from('tracks').select('id, display_name, name').in('id', trackIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; name: string }[] }),
  ])

  const profiles = new Map((profilesRes.data ?? []).map(p => [p.id, p]))
  const versions = new Map((versionsRes.data ?? []).map(v => [v.id, v]))
  const tracks = new Map((tracksRes.data ?? []).map(t => [t.id, t]))

  // Resolve projects for context version + message channel (band feed).
  const projectIds = [
    ...new Set([
      ...(versionsRes.data ?? []).map(v => v.project_id).filter(Boolean),
      ...rows.map(r => r.channel_id).filter(Boolean),
    ]),
  ] as string[]
  const projectsRes = projectIds.length
    ? await supabase.from('projects').select('id, bpm, time_signature').in('id', projectIds)
    : { data: [] as { id: string; bpm: number | null; time_signature: string | null }[] }
  const projects = new Map((projectsRes.data ?? []).map(p => [p.id, p]))

  return rows.map(r => {
    const author = profiles.get(r.user_id)
    const version = r.context_version_id ? versions.get(r.context_version_id) : undefined
    const track = r.context_track_id ? tracks.get(r.context_track_id) : undefined
    const project = version ? projects.get(version.project_id) : undefined
    const channelProject = r.channel_id ? projects.get(r.channel_id) : undefined
    const resolvedProject = project ?? channelProject
    return {
      id: r.id,
      band_id: r.band_id,
      channel_id: r.channel_id,
      user_id: r.user_id,
      content: r.content,
      type: r.type === 'track_comment' ? 'track_comment' : 'message',
      context_version_id: r.context_version_id,
      context_track_id: r.context_track_id,
      context_timecode_start_ms: r.context_timecode_start_ms,
      context_timecode_end_ms: r.context_timecode_end_ms,
      source_track_comment_id: r.source_track_comment_id,
      created_at: r.created_at,
      author_username: author?.username ?? 'unknown',
      author_avatar_color: author?.avatar_color ?? null,
      context_version_name: version?.name ?? null,
      context_track_name: track?.display_name || track?.name || null,
      context_project_id: version?.project_id ?? r.channel_id ?? null,
      context_project_bpm: resolvedProject?.bpm ?? null,
      context_project_time_signature: resolvedProject?.time_signature ?? null,
    }
  })
}

// GET /api/bands/[id]/messages
//   ?channel=[projectId|band]   list a channel (50 newest, DESC)
//   &before=[iso]               pagination cursor (older than this created_at)
//   &after=[iso]                 messages newer than this created_at (ASC, for live sync)
//   ?message=[id]               fetch a single enriched message (realtime handler)
//   ?counts=1                   per-channel message counts for the band
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bandId } = await params
    const access = await requireBandMembership(req, bandId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const url = new URL(req.url)

    // ── Per-channel counts ──
    if (url.searchParams.get('counts')) {
      const { data: projectRows } = await supabase
        .from('projects')
        .select('id')
        .eq('band_id', bandId)
      const projectIds = (projectRows ?? []).map(p => p.id)

      const bandCount = await supabase
        .from('band_messages')
        .select('id', { count: 'exact', head: true })
        .eq('band_id', bandId)

      const perProject = await Promise.all(
        projectIds.map(async pid => {
          const res = await supabase
            .from('band_messages')
            .select('id', { count: 'exact', head: true })
            .eq('band_id', bandId)
            .eq('channel_id', pid)
          return [pid, res.count ?? 0] as const
        }),
      )

      const counts: Record<string, number> = { band: bandCount.count ?? 0 }
      for (const [pid, count] of perProject) counts[pid] = count
      return NextResponse.json({ counts })
    }

    // ── Single message (used to enrich a realtime INSERT) ──
    const messageId = url.searchParams.get('message')
    if (messageId) {
      const { data: row } = await supabase
        .from('band_messages')
        .select(MESSAGE_COLUMNS)
        .eq('band_id', bandId)
        .eq('id', messageId)
        .maybeSingle()
      if (!row) return NextResponse.json({ message: null })
      const [message] = await enrichMessages([row as RawMessage])
      return NextResponse.json({ message })
    }

    // ── Channel listing ──
    const channelParam = url.searchParams.get('channel')
    const before = url.searchParams.get('before')
    const after = url.searchParams.get('after')
    const isBandChannel = !channelParam || channelParam === 'band'

    // Validate project channel belongs to this band.
    if (!isBandChannel) {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', channelParam)
        .eq('band_id', bandId)
        .maybeSingle()
      if (!project) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    let query = supabase.from('band_messages').select(MESSAGE_COLUMNS).eq('band_id', bandId)

    if (after) {
      query = query.gt('created_at', after).order('created_at', { ascending: true }).limit(PAGE_SIZE)
    } else {
      query = query.order('created_at', { ascending: false }).limit(PAGE_SIZE)
      if (before) query = query.lt('created_at', before)
    }

    query = isBandChannel ? query : query.eq('channel_id', channelParam)

    const { data: rows, error } = await query
    if (error) {
      console.error('[bands/messages] list error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const messages = await enrichMessages((rows ?? []) as RawMessage[])
    return NextResponse.json({ messages, hasMore: (rows?.length ?? 0) === PAGE_SIZE })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bands/messages] GET error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST /api/bands/[id]/messages
// Body: { channel_id, content, context_version_id?, context_track_id?,
//         context_timecode_start_ms?, context_timecode_end_ms? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bandId } = await params
    const access = await requireBandMembership(req, bandId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId } = access

    const body = await req.json()
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

    const channelId: string | null = body.channel_id ?? null

    // Validate the project channel belongs to this band.
    if (channelId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', channelId)
        .eq('band_id', bandId)
        .maybeSingle()
      if (!project) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    }

    const { data: row, error } = await supabase
      .from('band_messages')
      .insert({
        band_id: bandId,
        channel_id: channelId,
        user_id: userId,
        content,
        type: 'message',
        context_version_id: body.context_version_id ?? null,
        context_track_id: body.context_track_id ?? null,
        context_timecode_start_ms: body.context_timecode_start_ms ?? null,
        context_timecode_end_ms: body.context_timecode_end_ms ?? null,
      })
      .select(MESSAGE_COLUMNS)
      .single()

    if (error) {
      console.error('[bands/messages] insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Mentions are stored as plain text in content; parsing here is a no-op
    // placeholder for future notification wiring.
    void extractMentions(content)

    const [message] = await enrichMessages([row as RawMessage])
    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bands/messages] POST error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

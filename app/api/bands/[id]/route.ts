import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

const BAND_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

// GET /api/bands/[id] — full band detail: projects (enhanced), members, stats, recentActivity
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  // ── Phase 1: top-level parallel fetches ───────────────────────────────────
  const [bandRes, projectsRes, membersRes] = await Promise.all([
    supabase.from('bands').select('*').eq('id', bandId).single(),
    supabase.from('projects')
      .select('id, name, bpm, key, created_at')
      .eq('band_id', bandId)
      .order('created_at', { ascending: false }),
    adminSupabase.from('band_members')
      .select('user_id, role, role_label, role_color, joined_at')
      .eq('band_id', bandId),
  ])

  if (bandRes.error) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const projects = projectsRes.data ?? []
  const projectIds = projects.map((p: { id: string }) => p.id)

  // ── Phase 2: version + profile fetches (parallel) ─────────────────────────
  const memberUserIds = (membersRes.data ?? []).map((m: { user_id: string }) => m.user_id)

  const [versionsRes, profilesRes] = await Promise.all([
    projectIds.length > 0
      ? supabase.from('versions')
          .select('id, project_id, type, merged_at, created_at')
          .in('project_id', projectIds)
      : Promise.resolve({ data: [] as { id: string; project_id: string; type: string; merged_at: string | null; created_at: string }[] }),
    memberUserIds.length > 0
      ? adminSupabase.from('profiles')
          .select('id, username, display_name, avatar_color')
          .in('id', memberUserIds)
      : Promise.resolve({ data: [] as { id: string; username: string; display_name: string | null; avatar_color: string | null }[] }),
  ])

  const allVersions = versionsRes.data ?? []
  const allVersionIds = allVersions.map((v: { id: string }) => v.id)

  // ── Phase 3: tracks + comments (parallel) ────────────────────────────────
  const [tracksRes, commentsRes] = await Promise.all([
    allVersionIds.length > 0
      ? supabase.from('tracks')
          .select('id, version_id, duration_ms, file_size_bytes, file_hash, position')
          .in('version_id', allVersionIds)
      : Promise.resolve({ data: [] as { id: string; version_id: string; duration_ms: number | null; file_size_bytes: number | null; file_hash: string | null; position: number }[] }),
    allVersionIds.length > 0
      ? supabase.from('track_comments')
          .select('id, version_id')
          .in('version_id', allVersionIds)
      : Promise.resolve({ data: [] as { id: string; version_id: string }[] }),
  ])

  const allTracks = tracksRes.data ?? []
  const allComments = commentsRes.data ?? []

  // ── Aggregate per-project data ────────────────────────────────────────────

  // Maps for fast lookup
  const versionToProject = new Map(
    allVersions.map((v: { id: string; project_id: string }) => [v.id, v.project_id])
  )
  const mainVersionByProject = new Map(
    allVersions
      .filter((v: { type: string }) => v.type === 'main')
      .map((v: { id: string; project_id: string }) => [v.project_id, v.id])
  )

  const tracksByVersion = new Map<string, typeof allTracks>()
  for (const t of allTracks) {
    const arr = tracksByVersion.get(t.version_id) ?? []
    arr.push(t)
    tracksByVersion.set(t.version_id, arr)
  }

  const versionsByProject = new Map<string, typeof allVersions>()
  for (const v of allVersions) {
    const arr = versionsByProject.get((v as { project_id: string }).project_id) ?? []
    arr.push(v)
    versionsByProject.set((v as { project_id: string }).project_id, arr)
  }

  const commentsByProject = new Map<string, number>()
  for (const c of allComments) {
    const pid = versionToProject.get(c.version_id)
    if (pid) commentsByProject.set(pid, (commentsByProject.get(pid) ?? 0) + 1)
  }

  const enhancedProjects = projects.map((p: { id: string; name: string; bpm: number | null; key: string | null; created_at: string }) => {
    const mainVersionId = mainVersionByProject.get(p.id)
    const mainTracks = mainVersionId ? (tracksByVersion.get(mainVersionId) ?? []) : []
    const projectVersions = versionsByProject.get(p.id) ?? []
    const sorted = [...projectVersions].sort(
      (a, b) => new Date((b as { created_at: string }).created_at).getTime() - new Date((a as { created_at: string }).created_at).getTime()
    )
    const lastVersion = sorted[0] as { created_at: string } | undefined
    const firstTrack = [...mainTracks].sort(
      (a, b) => ((a as { position: number }).position ?? 0) - ((b as { position: number }).position ?? 0)
    )[0] as { id: string } | undefined

    return {
      ...p,
      track_count: mainTracks.length,
      total_duration_ms: mainTracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0),
      version_count: projectVersions.length,
      comment_count: commentsByProject.get(p.id) ?? 0,
      last_updated_at: lastVersion?.created_at ?? p.created_at,
      first_track_id: firstTrack?.id ?? null,
    }
  })

  // ── Band-wide stats ────────────────────────────────────────────────────────
  const branches = allVersions.filter((v: { type: string }) => v.type === 'branch').length
  const merges = allVersions.filter((v: { merged_at: string | null }) => v.merged_at != null).length
  const totalComments = allComments.length
  const mainVersionIds = Array.from(mainVersionByProject.values())
  const totalTracks = allTracks.filter(t => mainVersionIds.includes(t.version_id)).length

  const seenHashes = new Set<string>()
  let storageBytes = 0
  for (const t of allTracks) {
    if (t.file_hash && !seenHashes.has(t.file_hash)) {
      seenHashes.add(t.file_hash)
      storageBytes += t.file_size_bytes ?? 0
    }
  }

  // ── Recent activity (graceful if table missing) ───────────────────────────
  let recentActivity: unknown[] = []
  let totalActivity = 0
  try {
    const [actRes, countRes] = await Promise.all([
      adminSupabase
        .from('band_activity')
        .select('id, action, subject, detail, created_at, user_id, project_id, projects(name)')
        .eq('band_id', bandId)
        .order('created_at', { ascending: false })
        .limit(5),
      adminSupabase
        .from('band_activity')
        .select('id', { count: 'exact', head: true })
        .eq('band_id', bandId),
    ])

    if (!actRes.error && actRes.data) {
      const actUserIds = [...new Set(actRes.data.map((a: { user_id: string }) => a.user_id).filter(Boolean))]
      const { data: actProfiles } = actUserIds.length
        ? await adminSupabase.from('profiles').select('id, username').in('id', actUserIds)
        : { data: [] as { id: string; username: string }[] }
      const actProfileMap = new Map((actProfiles ?? []).map((p: { id: string; username: string }) => [p.id, p.username]))
      recentActivity = actRes.data.map((a: { user_id: string; projects?: { name: string } | null }) => ({
        ...a,
        username: actProfileMap.get(a.user_id) ?? 'unknown',
        project_name: a.projects?.name ?? null,
        projects: undefined,
      }))
      totalActivity = countRes.count ?? 0
    }
  } catch { /* band_activity table may not exist yet */ }

  // ── Build members list ────────────────────────────────────────────────────
  const profileMap = new Map(
    (profilesRes.data ?? []).map((p: { id: string }) => [p.id, p])
  )
  const members = (membersRes.data ?? []).map((m: {
    user_id: string; role: string; role_label: string | null;
    role_color: string | null; joined_at: string
  }) => ({
    ...m,
    profiles: profileMap.get(m.user_id) ?? null,
  }))

  return NextResponse.json({
    band: bandRes.data,
    projects: enhancedProjects,
    members,
    myRole: membership.role,
    stats: { branches, merges, comments: totalComments, storage_bytes: storageBytes, tracks: totalTracks },
    recentActivity,
    totalActivity,
    storageLimitBytes: BAND_STORAGE_LIMIT_BYTES,
  })
}

// DELETE /api/bands/[id] — owner deletes band (cascades via FK)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: bandId } = await params

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (membership.role !== 'owner') return NextResponse.json({ error: 'Only owners can delete a band' }, { status: 403 })

  const { error } = await supabase.from('bands').delete().eq('id', bandId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

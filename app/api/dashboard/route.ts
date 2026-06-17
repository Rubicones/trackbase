import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

// GET /api/dashboard — all data needed for the bands list page
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminSupabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  )

  // ── Phase 1: user's band memberships ──────────────────────────────────────
  const { data: memberships, error: mErr } = await adminSupabase
    .from('band_members')
    .select('band_id, role, role_label, bands(id, name, created_at)')
    .eq('user_id', userId)

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 })
  }

  const memberRows = memberships ?? []
  const bandIds = memberRows.map((m: { band_id: string }) => m.band_id)

  // Pending join requests — shown in the list but not accessible yet
  const { data: pendingRequests } = await adminSupabase
    .from('band_join_requests')
    .select('id, band_id, created_at, bands(id, name, created_at)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  const pendingBands = (pendingRequests ?? [])
    .filter((r: { band_id: string }) => !bandIds.includes(r.band_id))
    .map((r: {
      id: string
      band_id: string
      created_at: string
      bands: { id: string; name: string; created_at: string } | { id: string; name: string; created_at: string }[] | null
    }) => {
      const band = Array.isArray(r.bands) ? r.bands[0] : r.bands
      if (!band) return null
      return {
        id: band.id,
        name: band.name,
        created_at: band.created_at,
        userRole: 'pending',
        userRoleLabel: null,
        projectCount: 0,
        memberCount: 0,
        lastUpdated: r.created_at,
        latestActivity: null,
        storageBytes: 0,
        storageLimitBytes: STORAGE_LIMIT_BYTES,
        isPending: true,
        joinRequestId: r.id,
        joinRequestedAt: r.created_at,
      }
    })
    .filter(Boolean)

  if (!memberRows.length) {
    return NextResponse.json({
      bands: pendingBands,
      totalBands: 0,
      totalProjects: 0,
      totalCollaborators: 0,
      storageLimitBytes: STORAGE_LIMIT_BYTES,
    })
  }

  // ── Phase 2: parallel fetches ─────────────────────────────────────────────
  const [projectsRes, allMembersRes] = await Promise.all([
    supabase.from('projects').select('id, band_id, created_at').in('band_id', bandIds),
    adminSupabase.from('band_members').select('band_id, user_id').in('band_id', bandIds),
  ])

  const allProjects = projectsRes.data ?? []
  const allMembers = allMembersRes.data ?? []
  const projectIds = allProjects.map((p: { id: string }) => p.id)

  // Activity (graceful — table may not exist yet)
  let allActivity: {
    id: string; band_id: string; action: string; subject: string
    detail: string | null; created_at: string
    projects?: { name: string } | null
  }[] = []
  try {
    const { data, error } = await adminSupabase
      .from('band_activity')
      .select('id, band_id, action, subject, detail, created_at, projects(name)')
      .in('band_id', bandIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(bandIds.length * 5, 50))
    if (!error) allActivity = (data ?? []) as unknown as typeof allActivity
  } catch { /* band_activity may not exist yet */ }

  // ── Phase 3: versions ─────────────────────────────────────────────────────
  const versionsRes = projectIds.length > 0
    ? await supabase.from('versions').select('id, project_id').in('project_id', projectIds)
    : { data: [] as { id: string; project_id: string }[] }
  const allVersions = versionsRes.data ?? []
  const versionIds = allVersions.map((v: { id: string }) => v.id)

  // ── Phase 4: tracks (for storage) ─────────────────────────────────────────
  const tracksRes = versionIds.length > 0
    ? await supabase.from('tracks').select('version_id, file_size_bytes, file_hash').in('version_id', versionIds)
    : { data: [] as { version_id: string; file_size_bytes: number | null; file_hash: string | null }[] }
  const allTracks = tracksRes.data ?? []

  // ── Build lookup maps ─────────────────────────────────────────────────────

  type Project = { id: string; band_id: string; created_at: string }
  type Member = { band_id: string; user_id: string }
  type Track = { version_id: string; file_size_bytes: number | null; file_hash: string | null }
  type Version = { id: string; project_id: string }

  const projectsByBand = new Map<string, Project[]>()
  for (const p of allProjects as Project[]) {
    const arr = projectsByBand.get(p.band_id) ?? []
    arr.push(p); projectsByBand.set(p.band_id, arr)
  }

  const membersByBand = new Map<string, Member[]>()
  for (const m of allMembers as Member[]) {
    const arr = membersByBand.get(m.band_id) ?? []
    arr.push(m); membersByBand.set(m.band_id, arr)
  }

  const versionsByProject = new Map<string, string[]>()
  for (const v of allVersions as Version[]) {
    const arr = versionsByProject.get(v.project_id) ?? []
    arr.push(v.id); versionsByProject.set(v.project_id, arr)
  }

  const tracksByVersion = new Map<string, Track[]>()
  for (const t of allTracks as Track[]) {
    const arr = tracksByVersion.get(t.version_id) ?? []
    arr.push(t); tracksByVersion.set(t.version_id, arr)
  }

  // Latest activity per band (allActivity is ordered DESC)
  const latestActivityByBand = new Map<string, typeof allActivity[0]>()
  for (const a of allActivity) {
    if (!latestActivityByBand.has(a.band_id)) latestActivityByBand.set(a.band_id, a)
  }

  // ── Aggregate per band ────────────────────────────────────────────────────
  const bands = (memberRows as unknown as {
    band_id: string; role: string; role_label: string | null
    bands: { id: string; name: string; created_at: string }
  }[]).map(m => {
    const band = m.bands
    const projects = projectsByBand.get(m.band_id) ?? []
    const members = membersByBand.get(m.band_id) ?? []

    // Storage: sum distinct file_size_bytes by file_hash
    const seenHashes = new Set<string>()
    let storageBytes = 0
    for (const p of projects) {
      for (const vid of (versionsByProject.get(p.id) ?? [])) {
        for (const t of (tracksByVersion.get(vid) ?? [])) {
          if (t.file_hash && !seenHashes.has(t.file_hash)) {
            seenHashes.add(t.file_hash)
            storageBytes += t.file_size_bytes ?? 0
          }
        }
      }
    }

    // lastUpdated: latest project created_at vs latest activity
    const latestProjectDate = projects.reduce(
      (max, p) => p.created_at > max ? p.created_at : max, band.created_at
    )
    const latestAct = latestActivityByBand.get(m.band_id)
    const lastUpdated = latestAct && latestAct.created_at > latestProjectDate
      ? latestAct.created_at
      : latestProjectDate

    return {
      id: band.id,
      name: band.name,
      created_at: band.created_at,
      userRole: m.role,
      userRoleLabel: m.role_label,
      projectCount: projects.length,
      memberCount: members.length,
      lastUpdated,
      latestActivity: latestAct ? {
        action: latestAct.action,
        subject: latestAct.subject,
        detail: latestAct.detail,
        created_at: latestAct.created_at,
        project_name: (latestAct.projects as { name: string } | null)?.name ?? null,
      } : null,
      storageBytes,
      storageLimitBytes: STORAGE_LIMIT_BYTES,
      isPending: false,
    }
  })

  const allBands = [...bands, ...pendingBands]

  // ── Top-level stats ───────────────────────────────────────────────────────
  const totalProjects = bands.reduce((s, b) => s + b.projectCount, 0)
  const allCollaboratorIds = new Set(
    (allMembers as Member[]).map(m => m.user_id).filter(id => id !== userId)
  )

  return NextResponse.json({
    bands: allBands,
    totalBands: bands.length,
    totalProjects,
    totalCollaborators: allCollaboratorIds.size,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
  })
}

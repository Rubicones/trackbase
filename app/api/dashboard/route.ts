import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'


import { getBandLimitStatus, type BandLimitStatus } from '@/lib/bandLimit'
import { settleAccount } from '@/lib/bandFreeze'
import { serverErrorResponse } from '@/lib/apiErrors'
import { getBandEntitlements, getEffectiveEntitlements } from '@/lib/entitlements'
import { mbToBytes } from '@/lib/plans'

// GET /api/dashboard — all data needed for the bands list page
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Display value for the "create a space" affordance. Null (rather than a
  // guessed number) when it can't be read — the UI then stays unlocked and the
  // server still refuses the create, which is the safe way round.
  let bandLimit: BandLimitStatus | null = null
  try {
    bandLimit = await getBandLimitStatus(userId)
  } catch (err) {
    console.error('[dashboard] band limit unavailable', err)
  }

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
    return serverErrorResponse('dashboard', mErr, 'Could not load your dashboard')
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
        // A band the user has only REQUESTED to join. Its ceiling comes from
        // its owner's plan, which is not a non-member's business, and the
        // pending card never renders storage anyway — so no number is claimed
        // here. It must not be the flat `BAND_STORAGE_LIMIT_BYTES` constant,
        // whose own docblock says not to use it as a value.
        storageLimitBytes: null,
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
      storageLimitBytes: await accountStorageLimitBytes(userId),
      bandLimit,
    })
  }

  // The dashboard renders the grace banner and the band cards side by side,
  // so it has to settle the account for the same reason /api/me/plan does —
  // and before reading the freeze flags, or the two halves of one screen
  // disagree for a load.
  await settleAccount(userId)

  // Which of these bands are frozen.
  //
  // Read on its own rather than joined onto the membership select, because the
  // freeze columns arrive with a migration that is applied by hand (AGENTS.md
  // §5) and a 42703 inside that join would take the whole dashboard down over
  // a feature that is simply not switched on yet. Absent columns mean nothing
  // is frozen, which is the truth in that state.
  const frozenBandIds = await readFrozenBandIds(bandIds)

  // Per-band storage ceilings, resolved the way `GET /api/bands/[id]` resolves
  // them: the BAND OWNER's plan plus that band's `extra_storage` addons. This
  // route used the flat pre-plans constant, so a free user was shown 1 GB
  // against a real ceiling of 500 MB (twice what they have) and a Band+ user
  // was shown 1 GB against 50 GB (2% of what they bought).
  //
  // Resolved in parallel, one entitlement read per band — the same cost the
  // band page already pays for one band, and the loop over bands already
  // exists below.
  const storageLimitByBand = await resolveStorageLimits(bandIds)

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

  const resourcesRes = projectIds.length > 0
    ? await supabase.from('project_resources').select('project_id, file_size_bytes').in('project_id', projectIds).eq('type', 'file')
    : { data: [] as { project_id: string; file_size_bytes: number | null }[] }
  const allResources = resourcesRes.data ?? []

  // ── Build lookup maps ─────────────────────────────────────────────────────

  type Project = { id: string; band_id: string; created_at: string }
  type Member = { band_id: string; user_id: string }
  type Track = { version_id: string; file_size_bytes: number | null; file_hash: string | null }
  type Version = { id: string; project_id: string }
  type Resource = { project_id: string; file_size_bytes: number | null }

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

  const resourcesByProject = new Map<string, number>()
  for (const r of allResources as Resource[]) {
    resourcesByProject.set(r.project_id, (resourcesByProject.get(r.project_id) ?? 0) + (r.file_size_bytes ?? 0))
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
      storageBytes += resourcesByProject.get(p.id) ?? 0
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
      storageLimitBytes: storageLimitByBand.get(m.band_id) ?? null,
      // Display only. The write block is enforced server-side on every
      // endpoint whether this flag was sent or not (`lib/bandFreeze.ts`).
      frozen: frozenBandIds.has(band.id),
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
    storageLimitBytes: await accountStorageLimitBytes(userId),
    bandLimit,
  })
}

/**
 * Per-band ceiling for each of these bands, in bytes. Null means unlimited —
 * or that the band's entitlements could not be read, in which case the card
 * shows no ceiling rather than a wrong one. The server refuses an over-quota
 * upload either way (`lib/planGuards.ts`); nothing here is enforcement.
 */
async function resolveStorageLimits(bandIds: string[]): Promise<Map<string, number | null>> {
  const entries = await Promise.all(
    bandIds.map(async bandId => {
      try {
        const entitlements = await getBandEntitlements(bandId)
        return [bandId, mbToBytes(entitlements.storagePerBandMB)] as const
      } catch (err) {
        console.error('[dashboard] storage limit unavailable for band', bandId, err)
        return [bandId, null] as const
      }
    }),
  )
  return new Map(entries)
}

/**
 * The top-level `storageLimitBytes` on this response.
 *
 * There is no account-wide storage total in this app and there must not be
 * one (AGENTS.md §4) — storage is per band and is never pooled. This field
 * predates plans and no current client reads it; it is kept, and resolved
 * from the user's OWN plan, as the per-band figure a band they create would
 * start with. It is a display fallback, not a total and not a ceiling.
 */
async function accountStorageLimitBytes(userId: string): Promise<number | null> {
  try {
    const entitlements = await getEffectiveEntitlements(userId)
    return mbToBytes(entitlements.storagePerBandMB)
  } catch (err) {
    console.error('[dashboard] account storage limit unavailable', err)
    return null
  }
}


/**
 * Band ids that are currently frozen, degrading to "none" when the freeze
 * columns are not in the database yet.
 */
async function readFrozenBandIds(bandIds: string[]): Promise<Set<string>> {
  if (!bandIds.length) return new Set()
  const { data, error } = await supabase
    .from('bands')
    .select('id, frozen_at')
    .in('id', bandIds)
    .not('frozen_at', 'is', null)
  if (error) return new Set()
  return new Set((data ?? []).map((b: { id: string }) => b.id))
}

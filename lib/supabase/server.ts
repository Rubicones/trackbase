/**
 * Server-side auth utilities.
 *
 * We can't use @supabase/ssr (npm 403 in this env), so we decode the
 * JWT that the browser client stores in the sb-at cookie.
 *
 * The Supabase access token is a standard RS256 JWT.  We only *decode*
 * (base64), never verify the signature — the payload is trusted because
 * it was issued by Supabase and is only accessible server-side via cookies
 * that were set by our own AuthContext.
 *
 * IMPORTANT: All DB queries use the service-role client which bypasses RLS.
 * Access control is therefore enforced here, in application code.  Every
 * route handler that touches project / version / track / section / comment
 * data MUST call requireBandMember (or one of the resource-specific helpers
 * below) before returning any data or performing any mutation.
 */

import type { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  decodeJwt,
  refreshAccessToken,
  type JwtPayload,
} from '@/lib/auth/session'

export type { JwtPayload }

/**
 * Extract the user ID from a JWT cookie value.
 * Returns null if invalid / expired.
 */
export function getUserIdFromToken(token: string): string | null {
  return decodeJwt(token)?.sub ?? null
}

/**
 * Get the username stored in user_metadata from a JWT.
 * Returns null if the token is invalid or the user hasn't completed onboarding.
 */
export function getUsernameFromToken(token: string): string | null {
  return decodeJwt(token)?.user_metadata?.username ?? null
}

// ── Application-level access control ─────────────────────────────────────────
//
// Because we use the service-role Supabase client everywhere (bypasses RLS),
// every route must call one of these guards before reading or mutating data.

/**
 * Extract the authenticated user ID from the request cookie.
 * Refreshes the access token when only the refresh token cookie is still valid.
 */
export async function getRequestUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value
  if (token) {
    const userId = getUserIdFromToken(token)
    if (userId) return userId
  }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const refreshed = await refreshAccessToken(refreshToken)
  if (!refreshed) return null

  return decodeJwt(refreshed.access_token)?.sub ?? null
}

export interface MembershipResult {
  userId: string
  project: { id: string; band_id: string }
  role: string
}

/**
 * Verify that the requesting user is an active member of the band that owns
 * the given project.  Returns the userId, project row, and membership role on
 * success, or an error descriptor that the route should forward as a response.
 *
 * Usage:
 *   const access = await requireBandMember(req, projectId)
 *   if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
 */
export async function requireBandMember(
  req: NextRequest,
  projectId: string,
): Promise<MembershipResult | { error: string; status: number }> {
  const userId = await getRequestUserId(req)
  if (!userId) return { error: 'Unauthorized', status: 401 }

  const { data: project } = await supabase
    .from('projects')
    .select('id, band_id')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Not found', status: 404 }

  const { data: membership } = await supabase
    .from('band_members')
    .select('role')
    .eq('band_id', project.band_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return { error: 'Not found', status: 404 }

  return { userId, project, role: membership.role }
}

// ── Resource-traversal helpers ────────────────────────────────────────────────
// These look up the owning project for resources that don't carry a project_id
// directly, then delegate to requireBandMember.

/** Resolve the project ID for a track, then enforce band membership. */
export async function requireBandMemberForTrack(
  req: NextRequest,
  trackId: string,
): Promise<MembershipResult & { track: { id: string; version_id: string } } | { error: string; status: number }> {
  const { data: track } = await supabase
    .from('tracks')
    .select('id, version_id')
    .eq('id', trackId)
    .single()
  if (!track) return { error: 'Not found', status: 404 }

  const { data: version } = await supabase
    .from('versions')
    .select('project_id')
    .eq('id', track.version_id)
    .single()
  if (!version) return { error: 'Not found', status: 404 }

  const access = await requireBandMember(req, version.project_id)
  if ('error' in access) return access
  return { ...access, track }
}

/** Resolve the project ID for a version, then enforce band membership. */
export async function requireBandMemberForVersion(
  req: NextRequest,
  versionId: string,
): Promise<MembershipResult & { version: { id: string; project_id: string } } | { error: string; status: number }> {
  const { data: version } = await supabase
    .from('versions')
    .select('id, project_id')
    .eq('id', versionId)
    .single()
  if (!version) return { error: 'Not found', status: 404 }

  const access = await requireBandMember(req, version.project_id)
  if ('error' in access) return access
  return { ...access, version }
}

/** Resolve the project ID for a section, then enforce band membership. */
export async function requireBandMemberForSection(
  req: NextRequest,
  sectionId: string,
): Promise<MembershipResult & { section: { id: string; version_id: string } } | { error: string; status: number }> {
  const { data: section } = await supabase
    .from('sections')
    .select('id, version_id, project_id')
    .eq('id', sectionId)
    .single()
  if (!section) return { error: 'Not found', status: 404 }

  const access = await requireBandMember(req, section.project_id)
  if ('error' in access) return access
  return { ...access, section }
}

/** Resolve the project ID for a comment, then enforce band membership. */
export async function requireBandMemberForComment(
  req: NextRequest,
  commentId: string,
): Promise<MembershipResult & { comment: { id: string; created_by: string } } | { error: string; status: number }> {
  const { data: comment } = await supabase
    .from('track_comments')
    .select('id, created_by, version_id')
    .eq('id', commentId)
    .single()
  if (!comment) return { error: 'Not found', status: 404 }

  const { data: version } = await supabase
    .from('versions')
    .select('project_id')
    .eq('id', comment.version_id)
    .single()
  if (!version) return { error: 'Not found', status: 404 }

  const access = await requireBandMember(req, version.project_id)
  if ('error' in access) return access
  return { ...access, comment }
}

/** Resolve the project ID for a comment reply, then enforce band membership. */
export async function requireBandMemberForReply(
  req: NextRequest,
  replyId: string,
): Promise<MembershipResult & { reply: { id: string; created_by: string; comment_id: string } } | { error: string; status: number }> {
  const { data: reply } = await supabase
    .from('comment_replies')
    .select('id, created_by, comment_id')
    .eq('id', replyId)
    .single()
  if (!reply) return { error: 'Not found', status: 404 }

  const access = await requireBandMemberForComment(req, reply.comment_id)
  if ('error' in access) return access
  return { ...access, reply }
}

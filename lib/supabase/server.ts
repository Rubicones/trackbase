/**
 * Server-side auth utilities.
 *
 * Session cookies (sb-at / sb-rt) are HttpOnly and set via POST /api/auth/session.
 * Access tokens are verified with Supabase Auth before trusting the user id.
 *
 * IMPORTANT: All DB queries use the service-role client which bypasses RLS.
 * Access control is therefore enforced here, in application code.  Every
 * route handler that touches project / version / track / section / comment
 * data MUST call requireBandMember (or one of the resource-specific helpers
 * below) before returning any data or performing any mutation.
 */

import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  decodeJwt,
  refreshAccessToken,
} from '@/lib/auth/session'
import { verifyAccessToken, type VerifiedUser } from '@/lib/auth/verify'

export type { VerifiedUser as JwtPayload }

/**
 * Return a currently-valid access token from the request cookies, refreshing
 * via the refresh cookie when the access token has expired. Null when neither
 * cookie yields a usable token.
 */
async function getValidAccessToken(req: NextRequest): Promise<string | null> {
  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value
  // decodeJwt returns null once the token is past its exp, so a truthy result
  // means the access token is still good to send as a Bearer credential.
  if (accessToken && decodeJwt(accessToken)) return accessToken

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const refreshed = await refreshAccessToken(refreshToken)
  return refreshed?.access_token ?? null
}

export interface AuthedRequest {
  /** Supabase client that acts as the user — RLS policies apply to its queries. */
  client: SupabaseClient
  user: { id: string; email: string | null }
}

/**
 * Build a Supabase client bound to the requesting user's access token, so
 * inserts/selects run under their JWT and RLS is enforced (unlike the shared
 * service-role `supabase` client). Returns null when the request is not
 * authenticated. Use this for user-owned rows the user is allowed to write
 * directly (e.g. feedback); keep using requireBandMember + service role for
 * resource access that RLS does not model.
 */
export async function getRequestAuthedClient(
  req: NextRequest,
): Promise<AuthedRequest | null> {
  const token = await getValidAccessToken(req)
  if (!token) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null

  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Pass the token explicitly: there is no persisted session server-side, so
  // getUser() must validate the JWT it's given rather than reading from storage.
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null

  return { client, user: { id: data.user.id, email: data.user.email ?? null } }
}

/**
 * Verify an access token and return the user id, or null if invalid.
 */
export async function getUserIdFromToken(token: string): Promise<string | null> {
  const verified = await verifyAccessToken(token)
  return verified?.id ?? null
}

/**
 * Get the username stored in user_metadata from a verified access token.
 */
export async function getUsernameFromToken(token: string): Promise<string | null> {
  const verified = await verifyAccessToken(token)
  return verified?.user_metadata?.username ?? null
}

/**
 * Extract the authenticated user from the request cookies.
 * Refreshes the access token when only the refresh token cookie is still valid.
 */
export async function getRequestUserId(req: NextRequest): Promise<string | null> {
  const user = await getRequestUser(req)
  return user?.id ?? null
}

/** Full verified user from cookies (includes user_metadata). */
export async function getRequestUser(req: NextRequest): Promise<VerifiedUser | null> {
  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value
  if (accessToken) {
    const verified = await verifyAccessToken(accessToken)
    if (verified) return verified
  }

  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return null

  const refreshed = await refreshAccessToken(refreshToken)
  if (!refreshed) return null

  return verifyAccessToken(refreshed.access_token)
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
): Promise<
  MembershipResult & { comment: { id: string; created_by: string } } | { error: string; status: number }
> {
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
): Promise<
  MembershipResult & { reply: { id: string; created_by: string; comment_id: string } } | { error: string; status: number }
> {
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

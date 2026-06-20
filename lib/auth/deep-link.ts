import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { AUTH_DEEP_LINK_SCHEME } from '@/lib/auth/constants'
import { getSupabaseClient } from '@/lib/supabase/client'
import { resolvePostLoginDestination } from '@/lib/auth/post-login'

export type MagicLinkCompletionResult =
  | { ok: true }
  | { ok: false; error: string }

function isAuthCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${AUTH_DEEP_LINK_SCHEME}:` && parsed.host === 'auth'
  } catch {
    return false
  }
}

function hashParamsFromUrl(url: string): URLSearchParams {
  const parsed = new URL(url)
  return new URLSearchParams(
    parsed.hash.startsWith('#') ? parsed.hash.substring(1) : parsed.hash,
  )
}

async function setSessionFromHashTokens(
  url: string,
  router: AppRouterInstance,
): Promise<MagicLinkCompletionResult> {
  const hashParams = hashParamsFromUrl(url)
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')

  if (!accessToken || !refreshToken) {
    return { ok: false, error: 'URL hash is missing access_token or refresh_token' }
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  if (!data.session) {
    return { ok: false, error: 'Session was not created' }
  }

  await resolvePostLoginDestination(router, data.session)
  return { ok: true }
}

/** Raw Supabase verify links copied from magic-link emails. */
async function verifyEmailLinkToken(
  url: string,
  router: AppRouterInstance,
): Promise<MagicLinkCompletionResult> {
  const parsed = new URL(url)
  const token = parsed.searchParams.get('token')
  const type = parsed.searchParams.get('type')

  if (!token || !type) {
    return { ok: false, error: 'Not a Supabase verify link (missing token or type)' }
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: type as 'magiclink' | 'email' | 'signup' | 'invite' | 'recovery' | 'email_change',
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  if (!data.session) {
    return { ok: false, error: 'Verification succeeded but no session was returned' }
  }

  await resolvePostLoginDestination(router, data.session)
  return { ok: true }
}

/**
 * Complete sign-in from a magic-link URL (implicit flow hash tokens).
 * Also accepts raw Supabase /verify links pasted from email.
 */
export async function completeAuthFromMagicLinkUrl(
  url: string,
  router: AppRouterInstance,
): Promise<MagicLinkCompletionResult> {
  const trimmed = url.trim()
  if (!trimmed) {
    return { ok: false, error: 'Paste a magic link URL' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  const hashParams = new URLSearchParams(
    parsed.hash.startsWith('#') ? parsed.hash.substring(1) : parsed.hash,
  )
  if (hashParams.get('access_token') && hashParams.get('refresh_token')) {
    return setSessionFromHashTokens(trimmed, router)
  }

  if (parsed.pathname.endsWith('/verify') || parsed.searchParams.has('token')) {
    return verifyEmailLinkToken(trimmed, router)
  }

  return {
    ok: false,
    error: 'Unrecognized link — paste the full URL from the email or the post-redirect callback URL',
  }
}

/**
 * Handle a native deep-link URL from the custom scheme.
 * Uses implicit flow (hash tokens) — matches the Supabase client default flowType.
 */
export async function handleAuthDeepLink(
  url: string,
  router: AppRouterInstance,
): Promise<boolean> {
  if (!isAuthCallbackUrl(url)) return false

  const result = await completeAuthFromMagicLinkUrl(url, router)
  if (!result.ok) {
    console.error('Failed to complete auth from deep link:', result.error)
  }
  return true
}

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { AUTH_DEEP_LINK_SCHEME } from '@/lib/auth/constants'
import { getSupabaseClient } from '@/lib/supabase/client'
import { resolvePostLoginDestination } from '@/lib/auth/post-login'

function isAuthCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === `${AUTH_DEEP_LINK_SCHEME}:` && parsed.host === 'auth'
  } catch {
    return false
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

  const parsed = new URL(url)
  const hashParams = new URLSearchParams(
    parsed.hash.startsWith('#') ? parsed.hash.substring(1) : parsed.hash,
  )
  const accessToken = hashParams.get('access_token')
  const refreshToken = hashParams.get('refresh_token')

  if (!accessToken || !refreshToken) {
    console.error('Auth deep link missing tokens in URL hash')
    return true
  }

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (error) {
    console.error('Failed to set session from deep link:', error)
    return true
  }

  if (data.session) {
    await resolvePostLoginDestination(router, data.session)
  }

  return true
}

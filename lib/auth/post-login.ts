import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient } from '@/lib/supabase/client'

export const AUTH_NEXT_STORAGE_KEY = 'tb-auth-next'

export function readAuthNextDestination(): string {
  try {
    const stored = sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY)
    if (stored) {
      sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY)
      return stored
    }
  } catch {
    /* noop */
  }
  return '/dashboard'
}

async function refreshAuthCookie(session: { access_token: string; expires_in?: number }) {
  document.cookie = `sb-at=${session.access_token}; path=/; max-age=${session.expires_in ?? 3600}; SameSite=Lax`
}

/** Shared post-magic-link navigation for web callback and native deep links. */
export async function resolvePostLoginDestination(
  router: AppRouterInstance,
  session: Session,
): Promise<void> {
  const supabase = getSupabaseClient()

  await refreshAuthCookie(session)

  const meta = session.user.user_metadata
  if (!meta?.username) {
    router.replace('/onboarding')
    return
  }

  if (meta.onboarding_complete) {
    router.replace(readAuthNextDestination())
    return
  }

  const statusRes = await fetch('/api/me/setup-status')
  const status = statusRes.ok ? await statusRes.json() : null

  if (status?.can_use_app) {
    const { error } = await supabase.auth.updateUser({
      data: { onboarding_complete: true },
    })
    if (!error) {
      const { data: { session: refreshed } } = await supabase.auth.refreshSession()
      if (refreshed) {
        await refreshAuthCookie(refreshed)
      }
    }
    router.replace(readAuthNextDestination())
    return
  }

  router.replace('/onboarding?step=3')
}

'use client'

/**
 * Where to send a user once they hold a valid session.
 *
 * This is the post-authentication logic that used to be duplicated in
 * `app/auth/page.tsx` (warm-session check) and `app/auth/callback/page.tsx`
 * (magic-link landing). It was extracted unchanged when email OTP replaced the
 * magic link, so that the OTP path and the still-supported magic-link callback
 * cannot drift apart: *how* the credential is entered changed, what happens
 * afterwards did not.
 *
 * Order of business, matching the previous behaviour exactly:
 *   1. mirror the session into the HttpOnly `sb-at` / `sb-rt` cookies
 *   2. no `user_metadata.username` yet → /onboarding
 *   3. `onboarding_complete` → the sanitized `next` path
 *   4. otherwise ask /api/me/setup-status: if the account can already use the
 *      app, mark onboarding complete, refresh the session, re-sync cookies and
 *      continue to `next`; if not, resume at /onboarding?step=3
 */

import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { setAuthCookies } from '@/lib/auth/cookies'

export type PostSignInSession = {
  user: {
    user_metadata?: { username?: string; onboarding_complete?: boolean }
  }
  access_token: string
  refresh_token: string
  expires_in?: number
}

/**
 * Resolves the path to redirect to. Does not navigate — callers pass the
 * result to `router.replace()` so this stays usable from any surface.
 */
export async function resolvePostSignInPath(
  supabase: SupabaseClient,
  session: PostSignInSession,
  next: string,
): Promise<string> {
  await setAuthCookies(session)

  const meta = session.user.user_metadata
  if (!meta?.username) return '/onboarding'
  if (meta.onboarding_complete) return next

  try {
    const statusRes = await fetch('/api/me/setup-status')
    const status = statusRes.ok ? await statusRes.json() : null

    if (status?.can_use_app) {
      const { error } = await supabase.auth.updateUser({
        data: { onboarding_complete: true },
      })
      if (!error) {
        const {
          data: { session: refreshed },
        } = await supabase.auth.refreshSession()
        if (refreshed) {
          await setAuthCookies(refreshed as Session)
        }
      }
      return next
    }
  } catch {
    return '/onboarding?step=3'
  }

  return '/onboarding?step=3'
}

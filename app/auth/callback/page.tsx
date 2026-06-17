'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth/AuthShell'
import { Spinner } from '@/components/ui/Spinner'

const NEXT_STORAGE_KEY = 'tb-auth-next'

export default function AuthCallbackPage() {
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const supabase = getSupabaseClient()

    function readNext(): string {
      try {
        const stored = sessionStorage.getItem(NEXT_STORAGE_KEY)
        if (stored) {
          sessionStorage.removeItem(NEXT_STORAGE_KEY)
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

    async function resolveDestination(session: {
      user: { id: string; user_metadata?: { username?: string; onboarding_complete?: boolean } }
      access_token: string
      expires_in?: number
    }) {
      await refreshAuthCookie(session)

      const meta = session.user.user_metadata
      if (!meta?.username) {
        router.replace('/onboarding')
        return
      }

      if (meta.onboarding_complete) {
        router.replace(readNext())
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
        router.replace(readNext())
        return
      }

      router.replace('/onboarding?step=3')
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event !== 'SIGNED_IN' || !session) return
        subscription.unsubscribe()
        resolveDestination(session)
      }
    )

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      subscription.unsubscribe()
      resolveDestination(session)
    })

    return () => subscription.unsubscribe()
  }, [router])

  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-4 animate-slide-in">
        <Spinner size={32} />
        <div className="text-center">
          <p className="m-0 font-display text-sm uppercase tracking-tight text-foreground">
            Signing you in
          </p>
          <p className="m-0 mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            Verifying your session…
          </p>
        </div>
      </div>
    </AuthShell>
  )
}

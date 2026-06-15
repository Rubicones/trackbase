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

    async function resolveDestination(userId: string, accessToken: string, expiresIn: number) {
      document.cookie = `sb-at=${accessToken}; path=/; max-age=${expiresIn}; SameSite=Lax`

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .maybeSingle()

      if (profile?.username) {
        router.replace(readNext())
      } else {
        router.replace('/onboarding')
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event !== 'SIGNED_IN' || !session) return
        subscription.unsubscribe()
        resolveDestination(
          session.user.id,
          session.access_token,
          session.expires_in ?? 3600,
        )
      }
    )

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      subscription.unsubscribe()
      resolveDestination(
        session.user.id,
        session.access_token,
        session.expires_in ?? 3600,
      )
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

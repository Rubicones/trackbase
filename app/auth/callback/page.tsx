'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { resolvePostLoginDestination } from '@/lib/auth/post-login'
import { AuthShell } from '@/components/auth/AuthShell'
import { Spinner } from '@/components/ui/Spinner'

export default function AuthCallbackPage() {
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const supabase = getSupabaseClient()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event !== 'SIGNED_IN' || !session) return
        subscription.unsubscribe()
        void resolvePostLoginDestination(router, session)
      },
    )

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      subscription.unsubscribe()
      void resolvePostLoginDestination(router, session)
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

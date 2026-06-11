'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const supabase = getSupabaseClient()

    async function resolveDestination(userId: string, accessToken: string, expiresIn: number) {
      // Set the auth cookie so middleware can read it immediately after redirect
      document.cookie = `sb-at=${accessToken}; path=/; max-age=${expiresIn}; SameSite=Lax`

      // Check the profiles table — user_metadata.username may lag behind (cache),
      // but the DB is always authoritative.
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .maybeSingle()

      if (profile?.username) {
        router.replace('/dashboard')
      } else {
        router.replace('/onboarding')
      }
    }

    // detectSessionInUrl: true on the browser client auto-exchanges the PKCE
    // code.  Wait for the SIGNED_IN event to get the fresh session.
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

    // Fallback: if the session is already in memory (e.g. user opened the link
    // in a tab where they were already signed in), onAuthStateChange won't fire.
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
    <main className="auth-shell">
      <div style={styles.card}>
        <Spinner />
        <p style={styles.text}>Signing you in…</p>
      </div>
    </main>
  )
}

function Spinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="14" cy="14" r="11" stroke="var(--border)" strokeWidth="2" />
      <path d="M14 3a11 11 0 0 1 11 11" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  },
  text: {
    fontSize: '0.9375rem',
    color: 'var(--text-muted)',
    margin: 0,
  },
}

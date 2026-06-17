'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { getSiteUrl } from '@/lib/site-url'
import {
  AuthShell,
  AuthCard,
  AuthCardHeader,
  AuthCardBody,
  AuthWaveAccent,
  AuthLoadingScreen,
} from '@/components/auth/AuthShell'
import {
  AuthFieldLabel,
  AuthInput,
  AuthButton,
  AuthHint,
  AuthDivider,
} from '@/components/auth/AuthPrimitives'

const NEXT_STORAGE_KEY = 'tb-auth-next'

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen label="Checking session" />}>
      <AuthPageContent />
    </Suspense>
  )
}

function AuthPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const meta = session.user.user_metadata
        if (!meta?.username) {
          router.replace('/onboarding')
        } else if (!meta?.onboarding_complete) {
          try {
            const statusRes = await fetch('/api/me/setup-status')
            const status = statusRes.ok ? await statusRes.json() : null
            if (status?.can_use_app) {
              await supabase.auth.updateUser({ data: { onboarding_complete: true } })
              const { data: { session: refreshed } } = await supabase.auth.refreshSession()
              if (refreshed) {
                document.cookie = `sb-at=${refreshed.access_token}; path=/; max-age=${refreshed.expires_in ?? 3600}; SameSite=Lax`
              }
              router.replace(next)
            } else {
              router.replace('/onboarding?step=3')
            }
          } catch {
            router.replace('/onboarding?step=3')
          }
        } else {
          router.replace(next)
        }
      } else {
        setChecking(false)
      }
    })
  }, [router, next])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      try {
        sessionStorage.setItem(NEXT_STORAGE_KEY, next)
      } catch {
        /* noop */
      }

      const supabase = getSupabaseClient()
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${getSiteUrl()}/auth/callback`,
        },
      })
      if (otpErr) throw otpErr
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (checking) return <AuthLoadingScreen label="Checking session" />

  return (
    <AuthShell>
      <AuthCard>
        <AuthWaveAccent />

        {sent ? (
          <>
            <AuthCardHeader
              tag="01 // Sign in"
              title="Check your email"
              subtitle="We sent a magic link to complete sign-in. No password needed."
            />
            <AuthCardBody className="space-y-4 text-center">
              <div className="mx-auto size-14 border border-ember/40 bg-ember-soft/30 grid place-items-center">
                <MailIcon />
              </div>

              <div>
                <p className="m-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Sent to
                </p>
                <p className="m-0 mt-1 font-mono text-sm text-foreground">{email}</p>
              </div>

              <AuthHint>
                Click the link in your inbox to sign in. You can close this tab once you&apos;re in.
              </AuthHint>

              <AuthDivider />

              <AuthButton variant="link" onClick={() => setSent(false)} className="w-auto mx-auto">
                Wrong email?
              </AuthButton>
            </AuthCardBody>
          </>
        ) : (
          <>
            <AuthCardHeader
              tag="01 // Sign in"
              title="Welcome back"
              subtitle="Enter your email and we'll send you a one-time sign-in link."
            />
            <AuthCardBody>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <AuthFieldLabel htmlFor="email">Email address</AuthFieldLabel>
                  <AuthInput
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value.trim().toLowerCase())}
                    placeholder="you@band.com"
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                {error && <AuthHint error>{error}</AuthHint>}

                <AuthButton
                  type="submit"
                  disabled={loading || !email.trim()}
                >
                  {loading ? 'Sending link…' : 'Continue with email →'}
                </AuthButton>

                <AuthHint>Magic link only — we never ask for a password.</AuthHint>
              </form>
            </AuthCardBody>
          </>
        )}
      </AuthCard>
    </AuthShell>
  )
}

function MailIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-ember">
      <rect x="3" y="5" width="18" height="14" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 9l9 6 9-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

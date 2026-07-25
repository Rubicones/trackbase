'use client'

/**
 * Magic-link landing page — retained after the move to email OTP.
 *
 * Primary sign-in is now the one-time code entered at /auth. This route stays
 * so that links already sitting in inboxes, and the link variant in the Supabase
 * email template, still resolve to a session. Nothing in the OTP flow depends on
 * it; if the email template ever drops `{{ .ConfirmationURL }}` entirely, this
 * page and `getAuthCallbackUrl()` can go with it.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth/safe-redirect'
import { resolvePostSignInPath, type PostSignInSession } from '@/lib/auth/post-sign-in'
import {
  AuthShell,
  AuthCard,
  AuthCardHeader,
  AuthCardBody,
} from '@/components/auth/AuthShell'
import { AuthButton, AuthHint } from '@/components/auth/AuthPrimitives'
import { Spinner } from '@/components/ui/Spinner'

const NEXT_STORAGE_KEY = 'tb-auth-next'
const CALLBACK_TIMEOUT_MS = 12_000

function readNext(): string {
  try {
    const stored = sessionStorage.getItem(NEXT_STORAGE_KEY)
    if (stored) {
      sessionStorage.removeItem(NEXT_STORAGE_KEY)
      return sanitizeRedirectPath(stored)
    }
  } catch {
    /* noop */
  }
  return sanitizeRedirectPath(null)
}

function parseAuthHashError(): string | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null

  const params = new URLSearchParams(hash)
  const error = params.get('error')
  if (!error) return null

  const description = params.get('error_description')?.replace(/\+/g, ' ')
  if (description) return description

  const code = params.get('error_code')
  if (code === 'otp_expired') return 'Email link is invalid or has expired.'
  if (error === 'access_denied') return 'Sign-in was denied. Please request a new link.'

  return 'Sign-in link could not be verified. Please request a new one.'
}

function clearAuthHash() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

export default function AuthCallbackPage() {
  const router = useRouter()
  const handled = useRef(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const hashError = parseAuthHashError()
    if (hashError) {
      clearAuthHash()
      setErrorMessage(hashError)
      return
    }

    const supabase = getSupabaseClient()
    let settled = false

    function fail(message: string) {
      if (settled) return
      settled = true
      setErrorMessage(message)
    }

    // Shared with the OTP path in app/auth/page.tsx so the two entry points
    // cannot diverge — see lib/auth/post-sign-in.ts.
    async function resolveDestination(session: PostSignInSession) {
      if (settled) return
      settled = true
      router.replace(await resolvePostSignInPath(supabase, session, readNext()))
    }

    const timeoutId = window.setTimeout(() => {
      fail('Sign-in timed out. The link may have expired — please request a new one.')
    }, CALLBACK_TIMEOUT_MS)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event !== 'SIGNED_IN' || !session) return
        window.clearTimeout(timeoutId)
        subscription.unsubscribe()
        void resolveDestination(session)
      },
    )

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
      void resolveDestination(session)
    })

    return () => {
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [router])

  if (errorMessage) {
    return (
      <AuthShell>
        <AuthCard>
          <AuthCardHeader
            tag="01 // Sign in"
            title="Link expired"
            subtitle="This sign-in link is no longer valid."
          />
          <AuthCardBody className="space-y-4">
            <AuthHint error>{errorMessage}</AuthHint>
            <AuthButton onClick={() => router.replace('/auth')}>
              Back to email sign-in →
            </AuthButton>
          </AuthCardBody>
        </AuthCard>
      </AuthShell>
    )
  }

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

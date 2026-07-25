'use client'

/**
 * Email one-time-code sign-in.
 *
 * Two steps: request a code (`signInWithOtp`), then verify the typed code
 * (`verifyOtp`, type `'email'`). Supabase Auth owns the code — issuing,
 * hashing, expiry and single-use are all handled by the `auth` schema, so there
 * is nothing for us to store and no migration involved.
 *
 * Post-sign-in behaviour is deliberately untouched: both the warm-session check
 * and the verify success path go through `resolvePostSignInPath`, the same
 * helper `app/auth/callback/page.tsx` uses. `emailRedirectTo` is still passed so
 * that the magic link in the Supabase email template (and any link already sent)
 * keeps working — but the flow no longer depends on the user leaving the app,
 * which is what makes it reliable inside an embedded WebView.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { sanitizeRedirectPath } from '@/lib/auth/safe-redirect'
import { resolvePostSignInPath } from '@/lib/auth/post-sign-in'
import { getAuthCallbackUrl } from '@/lib/site-url'
import {
  OTP_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
  describeOtpError,
  parseOtpRetryAfterSeconds,
} from '@/lib/auth/otp'
import { trackEvent } from '@/lib/analytics'
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
import { OtpInput } from '@/components/auth/OtpInput'

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
  const next = sanitizeRedirectPath(searchParams.get('next'))

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [codeInvalid, setCodeInvalid] = useState(false)
  const [notice, setNotice] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [checking, setChecking] = useState(true)

  // Warm session — unchanged from the magic-link version.
  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setChecking(false)
        return
      }
      router.replace(await resolvePostSignInPath(supabase, session, next))
    })
  }, [router, next])

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setInterval(() => {
      setCooldown(current => (current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [cooldown])

  const requestCode = useCallback(
    async (address: string, mode: 'initial' | 'resend') => {
      setSending(true)
      setError('')
      setNotice('')
      try {
        try {
          sessionStorage.setItem(NEXT_STORAGE_KEY, next)
        } catch {
          /* noop */
        }

        const supabase = getSupabaseClient()
        const { error: otpErr } = await supabase.auth.signInWithOtp({
          email: address,
          options: {
            shouldCreateUser: true,
            // Retained so the link variant in the email template still works.
            emailRedirectTo: getAuthCallbackUrl(),
          },
        })
        if (otpErr) throw otpErr

        trackEvent(mode === 'resend' ? 'otp_code_resent' : 'otp_code_sent')
        setStep('code')
        setCode('')
        setCodeInvalid(false)
        setCooldown(OTP_RESEND_COOLDOWN_SECONDS)
        if (mode === 'resend') setNotice('New code sent.')
        return true
      } catch (err) {
        // Supabase's minimum interval between emails is a project setting we
        // cannot read, so if it rejects us we take the real number from the
        // error and correct the countdown to match.
        const retryAfter = parseOtpRetryAfterSeconds(err)
        if (retryAfter) setCooldown(retryAfter)
        setError(describeOtpError(err, 'send'))
        return false
      } finally {
        setSending(false)
      }
    },
    [next],
  )

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (!address) return
    trackEvent('sign_in_clicked')
    await requestCode(address, 'initial')
  }

  // Guards against a second verify firing while one is in flight — the input
  // auto-submits, and a stray Enter would otherwise burn the single-use code.
  const verifyingRef = useRef(false)

  const verifyCode = useCallback(
    async (token: string) => {
      if (verifyingRef.current) return
      verifyingRef.current = true
      setVerifying(true)
      setError('')
      setNotice('')
      try {
        const supabase = getSupabaseClient()
        const { data, error: verifyErr } = await supabase.auth.verifyOtp({
          email,
          token,
          type: 'email',
        })
        if (verifyErr) throw verifyErr
        if (!data.session) throw new Error('Token has expired or is invalid')

        trackEvent('otp_verified')
        // Same session handling and destination as the magic link had.
        router.replace(await resolvePostSignInPath(supabase, data.session, next))
      } catch (err) {
        trackEvent('otp_verify_failed')
        setError(describeOtpError(err, 'verify'))
        setCodeInvalid(true)
        setCode('')
        setVerifying(false)
        verifyingRef.current = false
      }
    },
    [email, next, router],
  )

  function handleCodeChange(value: string) {
    setCode(value)
    if (codeInvalid) {
      setCodeInvalid(false)
      setError('')
    }
  }

  function backToEmail() {
    setStep('email')
    setCode('')
    setCodeInvalid(false)
    setError('')
    setNotice('')
  }

  if (checking) return <AuthLoadingScreen label="Checking session" />

  return (
    <AuthShell>
      <AuthCard>
        <AuthWaveAccent />

        {step === 'code' ? (
          <>
            <AuthCardHeader
              tag="01 // Sign in"
              title="Enter your code"
              subtitle={`We emailed you a ${OTP_LENGTH}-digit sign-in code. No password needed.`}
            />
            <AuthCardBody className="space-y-4">
              <div className="text-center">
                <p className="m-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Sent to
                </p>
                <p className="m-0 mt-1 font-mono text-sm text-foreground break-all">{email}</p>
              </div>

              <form
                onSubmit={e => {
                  e.preventDefault()
                  if (code.length === OTP_LENGTH) void verifyCode(code)
                }}
                className="space-y-4"
              >
                <OtpInput
                  value={code}
                  onChange={handleCodeChange}
                  onComplete={verifyCode}
                  disabled={verifying}
                  invalid={codeInvalid}
                  autoFocus
                  label="Verification code"
                  hint={`Enter the ${OTP_LENGTH}-digit code from your email. It expires shortly.`}
                />

                {/* Assertive so a wrong code interrupts, since the input has
                    just been cleared underneath the user. */}
                <div aria-live="assertive" role="status">
                  {error && <AuthHint error>{error}</AuthHint>}
                </div>
                <div aria-live="polite" role="status">
                  {!error && notice && <AuthHint>{notice}</AuthHint>}
                  {!error && !notice && verifying && <AuthHint>Verifying your code…</AuthHint>}
                </div>

                <AuthButton
                  type="submit"
                  disabled={verifying || code.length < OTP_LENGTH}
                >
                  {verifying ? 'Verifying…' : 'Sign in →'}
                </AuthButton>
              </form>

              <AuthDivider />

              <div className="flex flex-col items-center gap-1">
                <AuthButton
                  variant="link"
                  disabled={sending || cooldown > 0 || verifying}
                  onClick={() => void requestCode(email, 'resend')}
                  className="w-auto mx-auto"
                >
                  {sending
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend code in ${cooldown}s`
                      : 'Resend code'}
                </AuthButton>
                <AuthButton
                  variant="link"
                  onClick={backToEmail}
                  disabled={verifying}
                  className="w-auto mx-auto"
                >
                  Wrong email?
                </AuthButton>
              </div>
            </AuthCardBody>
          </>
        ) : (
          <>
            <AuthCardHeader
              tag="01 // Sign in"
              title="Welcome back"
              subtitle="Enter your email and we'll send you a one-time sign-in code."
            />
            <AuthCardBody>
              <form onSubmit={handleEmailSubmit} className="space-y-4">
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

                <div aria-live="assertive" role="status">
                  {error && <AuthHint error>{error}</AuthHint>}
                </div>

                <AuthButton type="submit" disabled={sending || !email.trim()}>
                  {sending ? 'Sending code…' : 'Continue with email →'}
                </AuthButton>

                <AuthHint>One-time code only — we never ask for a password.</AuthHint>
              </form>
            </AuthCardBody>
          </>
        )}
      </AuthCard>
    </AuthShell>
  )
}

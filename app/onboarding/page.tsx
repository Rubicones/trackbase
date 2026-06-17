'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
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
  AuthInputStatus,
  AuthButton,
  AuthHint,
  AuthSteps,
  AuthModeCard,
} from '@/components/auth/AuthPrimitives'
import { ThemePicker } from '@/components/design/ThemePicker'

type OnboardingStep = 1 | 2 | 3

type BandMode = 'create' | 'join'
type CodeStatus = 'idle' | 'checking' | 'valid' | 'invalid'
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

async function persistUsername(userId: string, username: string) {
  const supabase = getSupabaseClient()
  const clean = username.trim().toLowerCase()

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ username: clean })
    .eq('id', userId)
  if (profileErr) throw profileErr

  const { error: metaErr } = await supabase.auth.updateUser({ data: { username: clean } })
  if (metaErr) throw metaErr

  const { data: { session: newSession }, error: refreshErr } = await supabase.auth.refreshSession()
  if (refreshErr) throw refreshErr
  if (newSession) {
    document.cookie = `sb-at=${newSession.access_token}; path=/; SameSite=Lax; max-age=${newSession.expires_in ?? 3600}`
  }
}

async function markOnboardingComplete() {
  const supabase = getSupabaseClient()
  const { error } = await supabase.auth.updateUser({ data: { onboarding_complete: true } })
  if (error) throw error
  const { data: { session: newSession }, error: refreshErr } = await supabase.auth.refreshSession()
  if (refreshErr) throw refreshErr
  if (newSession) {
    document.cookie = `sb-at=${newSession.access_token}; path=/; SameSite=Lax; max-age=${newSession.expires_in ?? 3600}`
  }
}

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const [step, setStep] = useState<OnboardingStep>(1)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [bandMode, setBandMode] = useState<BandMode>('create')
  const [bandName, setBandName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle')
  const [codeInfo, setCodeInfo] = useState<{
    band_id: string
    band_name: string
    member_count: number
    pending_request?: boolean
  } | null>(null)
  const [codeError, setCodeError] = useState('')
  const codeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading || !user) return

    if (user.user_metadata?.onboarding_complete) {
      router.replace('/dashboard')
      return
    }

    fetch('/api/me/setup-status')
      .then(r => r.json())
      .then(async status => {
        if (status.band_count > 0) {
          await markOnboardingComplete()
          await refreshProfile()
          router.replace('/dashboard')
          return
        }
        const stepParam = searchParams.get('step')
        if (user.user_metadata?.username) {
          setStep(3)
        } else if (stepParam === '2') {
          setStep(2)
        } else if (stepParam === '3') {
          setStep(1)
        }
      })
      .catch(() => {
        if (user.user_metadata?.username) setStep(3)
      })
  }, [authLoading, user, router, searchParams, refreshProfile])

  useEffect(() => {
    if (usernameDebounce.current) clearTimeout(usernameDebounce.current)
    const clean = username.trim().toLowerCase()

    if (!clean) {
      setUsernameStatus('idle')
      return
    }
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
      setUsernameStatus('invalid')
      return
    }

    setUsernameStatus('checking')
    usernameDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/auth/username-check?username=${encodeURIComponent(clean)}`)
      const { available } = await res.json()
      setUsernameStatus(available ? 'available' : 'taken')
    }, 500)

    return () => {
      if (usernameDebounce.current) clearTimeout(usernameDebounce.current)
    }
  }, [username])

  useEffect(() => {
    if (bandMode !== 'join') return
    if (codeDebounce.current) clearTimeout(codeDebounce.current)
    const raw = inviteCode.trim()
    if (!raw) {
      setCodeStatus('idle')
      setCodeInfo(null)
      setCodeError('')
      return
    }

    setCodeStatus('checking')
    codeDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/bands/join/check?code=${encodeURIComponent(raw)}`)
      const data = await res.json()
      if (data.valid) {
        setCodeStatus('valid')
        setCodeInfo({
          band_id: data.band_id,
          band_name: data.band_name,
          member_count: data.member_count,
          pending_request: data.pending_request,
        })
        setCodeError('')
      } else {
        setCodeStatus('invalid')
        setCodeInfo(null)
        setCodeError(data.error ?? 'Invalid invite code')
      }
    }, 500)

    return () => {
      if (codeDebounce.current) clearTimeout(codeDebounce.current)
    }
  }, [inviteCode, bandMode])

  async function handleUsernameContinue() {
    if (usernameStatus !== 'available' || !user || savingUsername) return
    setSavingUsername(true)
    setError('')
    try {
      await persistUsername(user.id, username)
      await refreshProfile()
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save username')
    } finally {
      setSavingUsername(false)
    }
  }

  async function handleFinish() {
    const canSubmit =
      bandMode === 'create'
        ? bandName.trim().length > 0
        : codeStatus === 'valid' && codeInfo !== null
    if (!canSubmit || submitting || !user) return

    setSubmitting(true)
    setError('')
    try {
      if (!user.user_metadata?.username) {
        await persistUsername(user.id, username)
      }

      if (bandMode === 'create') {
        const bandRes = await fetch('/api/bands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: bandName.trim() }),
        })
        if (!bandRes.ok) throw new Error((await bandRes.json()).error ?? 'Band creation failed')
        const { band } = await bandRes.json()
        await markOnboardingComplete()
        await refreshProfile()
        router.replace(`/band/${band.id}`)
        return
      }

      const joinRes = await fetch('/api/bands/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode.trim() }),
      })
      if (!joinRes.ok) throw new Error((await joinRes.json()).error ?? 'Failed to submit join request')
      await markOnboardingComplete()
      await refreshProfile()
      router.replace('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <AuthLoadingScreen />

  const canProceed =
    bandMode === 'create' ? bandName.trim().length > 0 : codeStatus === 'valid'

  const usernameFieldStatus =
    usernameStatus === 'checking'
      ? 'checking'
      : usernameStatus === 'available'
        ? 'valid'
        : usernameStatus === 'taken' || usernameStatus === 'invalid'
          ? 'invalid'
          : undefined

  const codeFieldStatus =
    codeStatus === 'checking'
      ? 'checking'
      : codeStatus === 'valid'
        ? 'valid'
        : codeStatus === 'invalid'
          ? 'invalid'
          : undefined

  const stepTitle =
    step === 1 ? 'Choose your theme' : step === 2 ? 'Pick a username' : 'Create or join a band'

  const stepSubtitle =
    step === 1
      ? 'Pick a look for Trackbase — you can change this anytime in settings.'
      : step === 2
        ? 'This is how your bandmates will see you across Trackbase.'
        : 'Start your own collective or request to join one with an invite code.'

  return (
    <AuthShell>
      <AuthCard wide>
        <AuthWaveAccent />

        <AuthCardHeader
          tag="02 // Onboarding"
          title={stepTitle}
          subtitle={stepSubtitle}
        />

        <AuthCardBody>
          <AuthSteps current={step} total={3} />

          {step === 1 ? (
            <div className="space-y-4">
              <div className="border border-border max-h-72 overflow-y-auto">
                <ThemePicker />
              </div>
              <AuthButton onClick={() => setStep(2)}>
                Continue →
              </AuthButton>
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              <AuthButton
                variant="link"
                className="w-auto py-0! -mt-1"
                onClick={() => setStep(1)}
              >
                ← Back
              </AuthButton>

              <div className="space-y-1.5">
                <AuthFieldLabel htmlFor="username">Username</AuthFieldLabel>
                <div className="relative">
                  <AuthInput
                    id="username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="john_doe"
                    autoFocus
                    status={usernameFieldStatus}
                    className="pr-9"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && usernameStatus === 'available') handleUsernameContinue()
                    }}
                  />
                  {usernameFieldStatus && <AuthInputStatus status={usernameFieldStatus} />}
                </div>
                <AuthHint error={usernameStatus === 'invalid' || usernameStatus === 'taken'}>
                  {usernameStatus === 'invalid'
                    ? '3–20 chars — letters, numbers, underscores only'
                    : usernameStatus === 'taken'
                      ? 'Username already taken'
                      : usernameStatus === 'available'
                        ? 'Looks good!'
                        : '3–20 characters, visible to your bandmates'}
                </AuthHint>
              </div>

              {error && <AuthHint error>{error}</AuthHint>}

              <AuthButton
                disabled={usernameStatus !== 'available' || savingUsername}
                onClick={handleUsernameContinue}
              >
                {savingUsername ? 'Saving…' : 'Continue →'}
              </AuthButton>
            </div>
          ) : (
            <div className="space-y-4">
              {!user?.user_metadata?.username && (
                <AuthButton
                  variant="link"
                  className="w-auto py-0! -mt-1"
                  onClick={() => setStep(2)}
                >
                  ← Back
                </AuthButton>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <AuthModeCard
                  selected={bandMode === 'create'}
                  onClick={() => setBandMode('create')}
                  icon={<PlusIcon />}
                  title="Create a band"
                  description="Start fresh and share your invite code"
                />
                <AuthModeCard
                  selected={bandMode === 'join'}
                  onClick={() => setBandMode('join')}
                  icon={<DoorIcon />}
                  title="Join a band"
                  description="Enter an invite code from the owner"
                  accent="online"
                />
              </div>

              {bandMode === 'create' ? (
                <div className="space-y-1.5">
                  <AuthFieldLabel htmlFor="band-name">Band name</AuthFieldLabel>
                  <AuthInput
                    id="band-name"
                    value={bandName}
                    onChange={e => setBandName(e.target.value.slice(0, 50))}
                    placeholder="e.g. The Noise"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleFinish()
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <AuthFieldLabel htmlFor="invite-code">Invite code</AuthFieldLabel>
                  <div className="relative">
                    <AuthInput
                      id="invite-code"
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="e.g. BLUE-JAM-42"
                      autoFocus
                      status={codeFieldStatus}
                      className="pr-9 font-mono tracking-wider"
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleFinish()
                      }}
                    />
                    {codeFieldStatus && <AuthInputStatus status={codeFieldStatus} />}
                  </div>
                  {codeStatus === 'valid' && codeInfo && (
                    <AuthHint>
                      {codeInfo.pending_request
                        ? `Request already pending for ${codeInfo.band_name} — the owner will review it soon.`
                        : `Request to join ${codeInfo.band_name} (${codeInfo.member_count} member${codeInfo.member_count !== 1 ? 's' : ''}). The owner must approve.`}
                    </AuthHint>
                  )}
                  {codeStatus === 'invalid' && <AuthHint error>{codeError}</AuthHint>}
                </div>
              )}

              {error && <AuthHint error>{error}</AuthHint>}

              <AuthButton disabled={!canProceed || submitting} onClick={handleFinish}>
                {submitting
                  ? 'Setting up…'
                  : bandMode === 'create'
                    ? 'Create band & continue →'
                    : codeInfo?.pending_request
                      ? 'Continue to dashboard →'
                      : 'Send join request →'}
              </AuthButton>
            </div>
          )}
        </AuthCardBody>
      </AuthCard>
    </AuthShell>
  )
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <OnboardingContent />
    </Suspense>
  )
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function DoorIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="13" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M16 8l5 4-5 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

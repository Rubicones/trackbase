'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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

type BandMode = 'create' | 'join'
type InviteStatus = 'idle' | 'checking' | 'valid' | 'invalid'
type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export default function OnboardingPage() {
  const router = useRouter()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)

  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [bandMode, setBandMode] = useState<BandMode>('create')
  const [bandName, setBandName] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('idle')
  const [inviteInfo, setInviteInfo] = useState<{
    band_id: string
    band_name: string
    member_count: number
  } | null>(null)
  const [inviteError, setInviteError] = useState('')
  const inviteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!authLoading && user?.user_metadata?.username) {
      router.replace('/dashboard')
    }
  }, [authLoading, user, router])

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
    if (inviteDebounce.current) clearTimeout(inviteDebounce.current)
    const raw = inviteInput.trim()
    if (!raw) {
      setInviteStatus('idle')
      setInviteInfo(null)
      setInviteError('')
      return
    }

    const token = raw.includes('/invite/') ? raw.split('/invite/')[1].trim() : raw

    setInviteStatus('checking')
    inviteDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/info`)
      const data = await res.json()
      if (data.valid) {
        setInviteStatus('valid')
        setInviteInfo({
          band_id: data.band_id,
          band_name: data.band_name,
          member_count: data.member_count,
        })
        setInviteError('')
      } else {
        setInviteStatus('invalid')
        setInviteInfo(null)
        setInviteError(data.error ?? 'Invalid or expired invite code')
      }
    }, 500)

    return () => {
      if (inviteDebounce.current) clearTimeout(inviteDebounce.current)
    }
  }, [inviteInput, bandMode])

  async function handleFinish() {
    const canSubmit =
      bandMode === 'create'
        ? bandName.trim().length > 0
        : inviteStatus === 'valid' && inviteInfo !== null
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError('')
    try {
      const supabase = getSupabaseClient()
      const clean = username.trim().toLowerCase()

      let targetBandId: string

      if (bandMode === 'create') {
        const bandRes = await fetch('/api/bands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: bandName.trim() }),
        })
        if (!bandRes.ok) throw new Error((await bandRes.json()).error ?? 'Band creation failed')
        const { band } = await bandRes.json()
        targetBandId = band.id
      } else {
        const rawToken = inviteInput.trim()
        const token = rawToken.includes('/invite/') ? rawToken.split('/invite/')[1].trim() : rawToken
        const joinRes = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
        })
        if (!joinRes.ok) throw new Error((await joinRes.json()).error ?? 'Failed to join band')
        const joinData = await joinRes.json()
        targetBandId = joinData.band_id
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ username: clean })
        .eq('id', user!.id)
      if (profileErr) throw profileErr

      const { error: metaErr } = await supabase.auth.updateUser({ data: { username: clean } })
      if (metaErr) throw metaErr

      const { data: { session: newSession }, error: refreshErr } = await supabase.auth.refreshSession()
      if (refreshErr) throw refreshErr
      if (newSession) {
        document.cookie = `sb-at=${newSession.access_token}; path=/; SameSite=Lax; max-age=${newSession.expires_in ?? 3600}`
      }

      await refreshProfile()
      router.replace(`/band/${targetBandId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) return <AuthLoadingScreen />

  const canProceed =
    bandMode === 'create' ? bandName.trim().length > 0 : inviteStatus === 'valid'

  const usernameFieldStatus =
    usernameStatus === 'checking'
      ? 'checking'
      : usernameStatus === 'available'
        ? 'valid'
        : usernameStatus === 'taken' || usernameStatus === 'invalid'
          ? 'invalid'
          : undefined

  const inviteFieldStatus =
    inviteStatus === 'checking'
      ? 'checking'
      : inviteStatus === 'valid'
        ? 'valid'
        : inviteStatus === 'invalid'
          ? 'invalid'
          : undefined

  return (
    <AuthShell>
      <AuthCard wide>
        <AuthWaveAccent />

        <AuthCardHeader
          tag="02 // Onboarding"
          title={step === 1 ? 'Pick a username' : 'Join or create a band'}
          subtitle={
            step === 1
              ? 'This is how your bandmates will see you across Trackbase.'
              : 'Start fresh or jump into an existing project. You can always do both later.'
          }
        />

        <AuthCardBody>
          <AuthSteps current={step} />

          {step === 1 ? (
            <div className="space-y-4">
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
                      if (e.key === 'Enter' && usernameStatus === 'available') setStep(2)
                    }}
                  />
                  {usernameFieldStatus && <AuthInputStatus status={usernameFieldStatus} />}
                </div>
                <AuthHint
                  error={usernameStatus === 'invalid' || usernameStatus === 'taken'}
                >
                  {usernameStatus === 'invalid'
                    ? '3–20 chars — letters, numbers, underscores only'
                    : usernameStatus === 'taken'
                      ? 'Username already taken'
                      : usernameStatus === 'available'
                        ? 'Looks good!'
                        : '3–20 characters, visible to your bandmates'}
                </AuthHint>
              </div>

              <AuthButton
                disabled={usernameStatus !== 'available'}
                onClick={() => setStep(2)}
              >
                Continue →
              </AuthButton>
            </div>
          ) : (
            <div className="space-y-4">
              <AuthButton
                variant="link"
                className="w-auto py-0! -mt-1"
                onClick={() => setStep(1)}
              >
                ← Back
              </AuthButton>

              <div className="flex flex-col sm:flex-row gap-3">
                <AuthModeCard
                  selected={bandMode === 'create'}
                  onClick={() => setBandMode('create')}
                  icon={<PlusIcon />}
                  title="Create a band"
                  description="Start fresh and invite your bandmates"
                />
                <AuthModeCard
                  selected={bandMode === 'join'}
                  onClick={() => setBandMode('join')}
                  icon={<DoorIcon />}
                  title="Join a band"
                  description="Paste an invite link or code"
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
                      value={inviteInput}
                      onChange={e => setInviteInput(e.target.value)}
                      placeholder="Paste invite link or code"
                      autoFocus
                      status={inviteFieldStatus}
                      className="pr-9"
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleFinish()
                      }}
                    />
                    {inviteFieldStatus && <AuthInputStatus status={inviteFieldStatus} />}
                  </div>
                  {inviteStatus === 'valid' && inviteInfo && (
                    <AuthHint>
                      You&apos;ll join: {inviteInfo.band_name} ({inviteInfo.member_count} member
                      {inviteInfo.member_count !== 1 ? 's' : ''})
                    </AuthHint>
                  )}
                  {inviteStatus === 'invalid' && <AuthHint error>{inviteError}</AuthHint>}
                </div>
              )}

              {error && <AuthHint error>{error}</AuthHint>}

              <AuthButton disabled={!canProceed || submitting} onClick={handleFinish}>
                {submitting
                  ? 'Setting up…'
                  : bandMode === 'create'
                    ? 'Create band & continue →'
                    : 'Join band & continue →'}
              </AuthButton>
            </div>
          )}
        </AuthCardBody>
      </AuthCard>
    </AuthShell>
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

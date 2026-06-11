'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { BrandSpinner } from '@/components/BrandSpinner'

// ─── Step indicator ───────────────────────────────────────────────────────────

function Steps({ current }: { current: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem' }}>
      {[1, 2].map(n => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600,
            background: n <= current ? 'var(--accent)' : 'var(--bg)',
            border: `0.5px solid ${n <= current ? 'var(--accent)' : 'var(--border)'}`,
            color: n <= current ? 'white' : 'var(--text-dim)',
          }}>{n < current ? '✓' : n}</div>
          {n < 2 && <div style={{ width: 24, height: 1, background: n < current ? 'var(--accent)' : 'var(--border)' }} />}
        </div>
      ))}
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>
        Step {current} of 2
      </span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type BandMode = 'create' | 'join'
type InviteStatus = 'idle' | 'checking' | 'valid' | 'invalid'

export default function OnboardingPage() {
  const router = useRouter()
  const { user, loading: authLoading, refreshProfile } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1: username
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Step 2: band
  const [bandMode, setBandMode] = useState<BandMode>('create')
  const [bandName, setBandName] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('idle')
  const [inviteInfo, setInviteInfo] = useState<{ band_id: string; band_name: string; member_count: number } | null>(null)
  const [inviteError, setInviteError] = useState('')
  const inviteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // If user already has a username, skip to dashboard
  useEffect(() => {
    if (!authLoading && user?.user_metadata?.username) {
      router.replace('/dashboard')
    }
  }, [authLoading, user, router])

  // Check username availability with 500ms debounce
  useEffect(() => {
    if (usernameDebounce.current) clearTimeout(usernameDebounce.current)
    const clean = username.trim().toLowerCase()

    if (!clean) { setUsernameStatus('idle'); return }
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) { setUsernameStatus('invalid'); return }

    setUsernameStatus('checking')
    usernameDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/auth/username-check?username=${encodeURIComponent(clean)}`)
      const { available } = await res.json()
      setUsernameStatus(available ? 'available' : 'taken')
    }, 500)

    return () => { if (usernameDebounce.current) clearTimeout(usernameDebounce.current) }
  }, [username])

  // Validate invite token with 500ms debounce
  useEffect(() => {
    if (bandMode !== 'join') return
    if (inviteDebounce.current) clearTimeout(inviteDebounce.current)
    const raw = inviteInput.trim()
    if (!raw) { setInviteStatus('idle'); setInviteInfo(null); setInviteError(''); return }

    const token = raw.includes('/invite/') ? raw.split('/invite/')[1].trim() : raw

    setInviteStatus('checking')
    inviteDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/info`)
      const data = await res.json()
      if (data.valid) {
        setInviteStatus('valid')
        setInviteInfo({ band_id: data.band_id, band_name: data.band_name, member_count: data.member_count })
        setInviteError('')
      } else {
        setInviteStatus('invalid')
        setInviteInfo(null)
        setInviteError(data.error ?? 'Invalid or expired invite code')
      }
    }, 500)

    return () => { if (inviteDebounce.current) clearTimeout(inviteDebounce.current) }
  }, [inviteInput, bandMode])

  async function handleFinish() {
    const canSubmit = bandMode === 'create'
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
        // Create band
        const bandRes = await fetch('/api/bands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: bandName.trim() }),
        })
        if (!bandRes.ok) throw new Error((await bandRes.json()).error ?? 'Band creation failed')
        const { band } = await bandRes.json()
        targetBandId = band.id
      } else {
        // Join band via invite
        const rawToken = inviteInput.trim()
        const token = rawToken.includes('/invite/') ? rawToken.split('/invite/')[1].trim() : rawToken
        const joinRes = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' })
        if (!joinRes.ok) throw new Error((await joinRes.json()).error ?? 'Failed to join band')
        const joinData = await joinRes.json()
        targetBandId = joinData.band_id
      }

      // Update profile username
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ username: clean })
        .eq('id', user!.id)
      if (profileErr) throw profileErr

      // Update user_metadata so JWT includes username
      const { error: metaErr } = await supabase.auth.updateUser({ data: { username: clean } })
      if (metaErr) throw metaErr

      // Force-refresh token so new user_metadata is in the JWT
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

  if (authLoading) return <LoadingScreen />

  const canProceed = bandMode === 'create'
    ? bandName.trim().length > 0
    : inviteStatus === 'valid'

  return (
    <main className="auth-shell">
      <div className="onboarding-card" style={styles.card}>
        <div style={styles.logo}>
          <span style={{ color: 'var(--text-sec)' }}>track</span>
          <span style={{ color: 'var(--accent)' }}>base</span>
        </div>
        <p style={styles.tagline}>Let's set up your profile</p>

        <Steps current={step} />

        {step === 1 ? (
          <div style={styles.section}>
            <label style={styles.label}>Pick a username</label>
            <div style={{ position: 'relative' }}>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="john_doe"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && usernameStatus === 'available') setStep(2) }}
                style={{
                  ...styles.input,
                  borderColor: usernameStatus === 'available' ? 'var(--green)'
                    : usernameStatus === 'taken' || usernameStatus === 'invalid' ? '#ef4444'
                    : 'var(--border)',
                }}
              />
              <div style={styles.inputStatus}>
                {usernameStatus === 'checking' && <SmallSpinner />}
                {usernameStatus === 'available' && <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                {usernameStatus === 'taken' && <span style={{ color: '#ef4444', fontSize: 12 }}>✗</span>}
              </div>
            </div>
            <p style={styles.hint}>
              {usernameStatus === 'invalid' ? '3–20 chars, letters, numbers, underscores only'
                : usernameStatus === 'taken' ? 'Username already taken'
                : usernameStatus === 'available' ? 'Looks good!'
                : '3–20 characters, visible to your bandmates'}
            </p>
            <button
              onClick={() => setStep(2)}
              disabled={usernameStatus !== 'available'}
              style={{
                ...styles.btn,
                opacity: usernameStatus !== 'available' ? 0.4 : 1,
                cursor: usernameStatus !== 'available' ? 'not-allowed' : 'pointer',
              }}
            >
              Continue →
            </button>
          </div>
        ) : (
          <div style={styles.section}>
            <button onClick={() => setStep(1)} style={styles.backBtn}>← Back</button>

            <p style={styles.stepTitle}>Join or create a band</p>
            <p style={styles.stepSub}>You can always do both later</p>

            {/* Two cards side by side */}
            <div className="onboarding-band-cards">
              <BandCard
                selected={bandMode === 'create'}
                onClick={() => setBandMode('create')}
                icon={<PlusIcon />}
                iconColor="var(--accent)"
                title="Create a band"
                desc="Start fresh and invite your bandmates"
                accentColor="var(--accent)"
              />
              <BandCard
                selected={bandMode === 'join'}
                onClick={() => setBandMode('join')}
                icon={<DoorIcon />}
                iconColor="var(--green)"
                title="Join a band"
                desc="Enter an invite code from your bandmates"
                accentColor="var(--green)"
              />
            </div>

            {/* Input below cards */}
            {bandMode === 'create' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Band name</label>
                <input
                  value={bandName}
                  onChange={e => setBandName(e.target.value.slice(0, 50))}
                  placeholder="e.g. The Noise"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleFinish() }}
                  style={styles.input}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={styles.label}>Invite code</label>
                <div style={{ position: 'relative' }}>
                  <input
                    value={inviteInput}
                    onChange={e => setInviteInput(e.target.value)}
                    placeholder="Paste invite link or code"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleFinish() }}
                    style={{
                      ...styles.input,
                      borderColor: inviteStatus === 'valid' ? 'var(--green)'
                        : inviteStatus === 'invalid' ? '#ef4444'
                        : 'var(--border)',
                    }}
                  />
                  <div style={styles.inputStatus}>
                    {inviteStatus === 'checking' && <SmallSpinner />}
                    {inviteStatus === 'valid' && <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>}
                    {inviteStatus === 'invalid' && <span style={{ color: '#ef4444', fontSize: 12 }}>✗</span>}
                  </div>
                </div>
                {inviteStatus === 'valid' && inviteInfo && (
                  <p style={{ fontSize: 12, color: 'var(--green)', margin: 0 }}>
                    You'll join: {inviteInfo.band_name} ({inviteInfo.member_count} member{inviteInfo.member_count !== 1 ? 's' : ''})
                  </p>
                )}
                {inviteStatus === 'invalid' && (
                  <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>{inviteError}</p>
                )}
              </div>
            )}

            {error && <p style={styles.error}>{error}</p>}

            <button
              onClick={handleFinish}
              disabled={!canProceed || submitting}
              style={{
                ...styles.btn,
                marginTop: 8,
                opacity: !canProceed || submitting ? 0.4 : 1,
                cursor: !canProceed || submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting
                ? 'Setting up…'
                : bandMode === 'create'
                ? 'Create band & continue →'
                : 'Join band & continue →'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

// ─── Band mode card ───────────────────────────────────────────────────────────

function BandCard({
  selected, onClick, icon, iconColor, title, desc, accentColor,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  iconColor: string
  title: string
  desc: string
  accentColor: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 20,
        borderRadius: 10,
        border: `0.5px solid ${selected ? accentColor : 'var(--border)'}`,
        background: selected
          ? `color-mix(in srgb, ${accentColor} 5%, var(--bg-surface))`
          : 'var(--bg-surface)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <span style={{ fontSize: 24, color: iconColor, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-soft)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</span>
    </button>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

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
      <rect x="3" y="3" width="13" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 8l5 4-5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function LoadingScreen() {
  return <BrandSpinner />
}

function SmallSpinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3" />
      <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '2rem',
  },
  card: {
    width: '100%',
    maxWidth: 460,
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border)',
    borderRadius: 16,
    padding: '2rem 1.75rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  logo: {
    fontSize: '1.125rem',
    fontWeight: 600,
    letterSpacing: '-0.03em',
    marginBottom: '0.25rem',
  },
  tagline: {
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
    marginBottom: '1.25rem',
  },
  section: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--text-bright)',
    margin: '4px 0 0',
  },
  stepSub: {
    fontSize: 13,
    color: 'var(--text-muted)',
    margin: '0 0 4px',
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    background: 'var(--bg)',
    border: '0.5px solid var(--border)',
    borderRadius: 8,
    padding: '0.5rem 2rem 0.5rem 0.75rem',
    color: 'var(--text)',
    fontSize: '0.9375rem',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  inputStatus: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  hint: {
    fontSize: '0.75rem',
    color: 'var(--text-dim)',
    margin: 0,
  },
  btn: {
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '0.625rem 1rem',
    fontWeight: 500,
    fontSize: '0.875rem',
    transition: 'background 0.15s',
    width: '100%',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: '0.75rem',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '0.25rem',
  },
  error: {
    color: '#f87171',
    fontSize: '0.8125rem',
    margin: 0,
  },
}

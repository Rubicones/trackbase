'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [bandId, setBandId] = useState<string | null>(null)

  useEffect(() => {
    // If not authed, send to auth with invite redirect
    if (!authLoading && !user) {
      router.replace(`/auth?next=/invite/${token}`)
    }
  }, [authLoading, user, token, router])

  async function handleAccept() {
    setStatus('accepting')
    try {
      const res = await fetch(`/api/invites/${token}/accept`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'Failed to accept invite')
        setStatus('error')
        return
      }
      setBandId(data.band_id)
      setStatus('success')
      setTimeout(() => router.push(`/band/${data.band_id}`), 1200)
    } catch {
      setMessage('Network error. Please try again.')
      setStatus('error')
    }
  }

  if (authLoading || !user) {
    return <Screen><p style={s.muted}>Redirecting…</p></Screen>
  }

  return (
    <Screen>
      <div style={s.card}>
        {/* Logo */}
        <div style={s.logo}>
          <span style={{ color: 'var(--text-sec)', fontWeight: 600 }}>track</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>base</span>
        </div>

        {status === 'success' ? (
          <>
            <div style={s.iconWrap}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="15" stroke="var(--green)" strokeWidth="1.2" />
                <path d="M10 16l5 5 7-8" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 style={s.title}>Joined!</h1>
            <p style={s.sub}>Redirecting you to the band…</p>
          </>
        ) : status === 'error' ? (
          <>
            <div style={s.iconWrap}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="15" stroke="#ef4444" strokeWidth="1.2" />
                <path d="M11 11l10 10M21 11l-10 10" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h1 style={s.title}>Invalid invite</h1>
            <p style={{ ...s.sub, color: '#f87171' }}>{message}</p>
            <button onClick={() => router.push('/dashboard')} style={s.btn}>Go to dashboard</button>
          </>
        ) : (
          <>
            <div style={s.iconWrap}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="15" stroke="var(--accent)" strokeWidth="1.2" />
                <path d="M10 16h12M10 11h6M10 21h6" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
            <h1 style={s.title}>You're invited</h1>
            <p style={s.sub}>Someone invited you to join their band on Trackbase.</p>
            <button
              onClick={handleAccept}
              disabled={status === 'accepting'}
              style={{ ...s.btn, opacity: status === 'accepting' ? 0.6 : 1 }}
            >
              {status === 'accepting' ? 'Joining…' : 'Accept invite →'}
            </button>
          </>
        )}
      </div>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '2rem' }}>
      {children}
    </main>
  )
}

const s: Record<string, React.CSSProperties> = {
  card: {
    width: '100%',
    maxWidth: 380,
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border)',
    borderRadius: 16,
    padding: '2.5rem 2rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logo: {
    fontSize: '1rem',
    letterSpacing: '-0.03em',
    display: 'flex',
    marginBottom: '1rem',
  },
  iconWrap: { marginBottom: '0.75rem' },
  title: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: 'var(--text-bright)',
    letterSpacing: '-0.02em',
    margin: 0,
  },
  sub: {
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
    textAlign: 'center',
    margin: '0 0 0.75rem',
    lineHeight: 1.5,
  },
  btn: {
    background: 'var(--accent)',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '0.625rem 1.5rem',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  muted: {
    color: 'var(--text-muted)',
    fontSize: 13,
  },
}

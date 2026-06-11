'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseClient } from '@/lib/supabase/client'

export default function AuthPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  // Start checking=true so the form never flashes before we know the auth state
  const [checking, setChecking] = useState(true)

  // If user already has a session, redirect immediately (no form flash)
  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const username = session.user.user_metadata?.username
        router.replace(username ? next : '/onboarding')
        // Don't setChecking(false) — keep blank while redirect happens
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
      const supabase = getSupabaseClient()
      const { error: otpErr } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
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

  if (checking) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />

  return (
    <main className="auth-shell">
      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
          <LogoIcon />
          <span style={styles.logoText}>
            <span style={{ color: 'var(--text-sec)' }}>track</span>
            <span style={{ color: 'var(--accent)' }}>base</span>
          </span>
        </div>
        <p style={styles.tagline}>Git-like versioning for music demos</p>

        {sent ? (
          <div className="auth-card-inner" style={styles.sentBox}>
            {/* Mail icon */}
            <div style={styles.iconWrap}>
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect x="4" y="10" width="32" height="22" rx="4" stroke="#6366F1" strokeWidth="1.5" />
                <path d="M4 16l16 10 16-10" stroke="#6366F1" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            <p style={styles.sentTitle}>Check your email</p>
            <p style={styles.sentLabel}>We sent a sign-in link to</p>
            <p style={styles.sentEmail}>{email}</p>
            <p style={styles.sentSub}>
              Click the link in the email to sign in.{' '}
              You can close this tab.
            </p>

            <div style={styles.divider} />

            <button style={styles.wrongBtn} onClick={() => setSent(false)}>
              Wrong email?
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-card-inner" style={styles.form}>
            <label style={styles.label}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value.trim().toLowerCase())}
              placeholder="you@band.com"
              required
              autoFocus
              style={styles.input}
            />
            {error && <p style={styles.error}>{error}</p>}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              style={{
                ...styles.btn,
                opacity: loading || !email.trim() ? 0.5 : 1,
                cursor: loading || !email.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Sending…' : 'Continue with email →'}
            </button>
            <p style={styles.hint}>
              We'll email you a sign-in link. No password needed.
            </p>
          </form>
        )}
      </div>
    </main>
  )
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="var(--accent)" opacity="0.15" />
      <path
        d="M8 6v4M8 14v4M16 6v4M16 14v4M8 10h2a2 2 0 0 1 2 2v0a2 2 0 0 0 2 2h2"
        stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"
      />
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
    padding: '2rem',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    marginBottom: '0.4rem',
  },
  logoText: {
    fontSize: '1.125rem',
    fontWeight: 600,
    letterSpacing: '-0.03em',
  },
  tagline: {
    fontSize: '0.8125rem',
    color: 'var(--text-muted)',
    marginBottom: '2rem',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border)',
    borderRadius: 12,
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  label: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    background: 'var(--bg)',
    border: '0.5px solid var(--border)',
    borderRadius: 8,
    padding: '0.5rem 0.75rem',
    color: 'var(--text)',
    fontSize: '0.9375rem',
    outline: 'none',
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
  },
  error: {
    color: '#f87171',
    fontSize: '0.8125rem',
    margin: 0,
  },
  hint: {
    fontSize: '0.75rem',
    color: 'var(--text-dim)',
    textAlign: 'center' as const,
    margin: 0,
  },
  // ── Sent state ──────────────────────────────────────────────────────────────
  sentBox: {
    width: '100%',
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border)',
    borderRadius: 12,
    padding: '2rem 1.75rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: '1.25rem',
  },
  sentTitle: {
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--text-bright)',
    margin: '0 0 0.5rem',
    textAlign: 'center',
  },
  sentLabel: {
    fontSize: 14,
    color: 'var(--text-muted)',
    margin: 0,
    textAlign: 'center',
  },
  sentEmail: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text)',
    margin: '0.125rem 0 0.75rem',
    textAlign: 'center',
  },
  sentSub: {
    fontSize: 13,
    color: 'var(--text-dim)',
    textAlign: 'center',
    lineHeight: 1.6,
    margin: 0,
  },
  divider: {
    width: '100%',
    height: '0.5px',
    background: 'var(--border)',
    margin: '1.25rem 0 1rem',
  },
  wrongBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-muted)',
    fontSize: 13,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
}

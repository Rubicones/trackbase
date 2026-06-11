'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar } from '@/components/Avatar'
import { getSupabaseClient } from '@/lib/supabase/client'

type ActiveSection = null | 'email' | 'username'

export function AvatarDropdown() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const { user, profile, signOut, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<ActiveSection>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  // Username edit state
  const [newUsername, setNewUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'saving' | 'saved'>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Email edit state
  const [newEmail, setNewEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle')
  const [emailError, setEmailError] = useState('')

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveSection(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Seed inputs when opening a section
  function openSection(s: ActiveSection) {
    setActiveSection(s)
    if (s === 'username') {
      setNewUsername(profile?.username ?? '')
      setUsernameStatus('idle')
    }
    if (s === 'email') {
      setNewEmail(user?.email ?? '')
      setEmailStatus('idle')
      setEmailError('')
    }
  }

  // Debounced username availability check
  useEffect(() => {
    if (activeSection !== 'username') return
    if (usernameDebounce.current) clearTimeout(usernameDebounce.current)
    const clean = newUsername.trim().toLowerCase()
    if (!clean || clean === profile?.username) { setUsernameStatus('idle'); return }
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) { setUsernameStatus('invalid'); return }

    setUsernameStatus('checking')
    usernameDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/auth/username-check?username=${encodeURIComponent(clean)}`)
      const { available } = await res.json()
      setUsernameStatus(available ? 'available' : 'taken')
    }, 500)
    return () => { if (usernameDebounce.current) clearTimeout(usernameDebounce.current) }
  }, [newUsername, activeSection, profile?.username])

  async function handleSaveUsername() {
    const clean = newUsername.trim().toLowerCase()
    if (!clean || clean === profile?.username || usernameStatus !== 'available') return
    setUsernameStatus('saving')
    try {
      const supabase = getSupabaseClient()
      const { error: profileErr } = await supabase.from('profiles').update({ username: clean }).eq('id', user!.id)
      if (profileErr) throw profileErr
      const { error: metaErr } = await supabase.auth.updateUser({ data: { username: clean } })
      if (metaErr) throw metaErr
      const { data: { session } } = await supabase.auth.refreshSession()
      if (session) {
        document.cookie = `sb-at=${session.access_token}; path=/; SameSite=Lax; max-age=${session.expires_in ?? 3600}`
      }
      await refreshProfile()
      setUsernameStatus('saved')
      setTimeout(() => { setActiveSection(null); setUsernameStatus('idle') }, 1000)
    } catch (err) {
      setUsernameStatus('idle')
      console.error(err)
    }
  }

  async function handleSaveEmail() {
    const trimmed = newEmail.trim()
    if (!trimmed || trimmed === user?.email) return
    setEmailStatus('saving')
    setEmailError('')
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.auth.updateUser({ email: trimmed })
      if (error) throw error
      setEmailStatus('sent')
    } catch (err) {
      setEmailStatus('error')
      setEmailError(err instanceof Error ? err.message : 'Failed to update email')
    }
  }

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    router.replace('/auth')
  }

  if (!profile) return null

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => { setOpen(o => !o); if (open) setActiveSection(null) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
      >
        <Avatar username={profile.username} size={32} />
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
          borderRadius: 10, padding: 8, minWidth: 220, zIndex: 100,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        }}>
          {/* Header */}
          <div style={{ padding: '8px 8px 10px', borderBottom: '0.5px solid var(--border)', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar username={profile.username} size={36} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0 }}>@{profile.username}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.email}
                </p>
              </div>
            </div>
          </div>

          {/* Change email */}
          <MenuRow
            icon={<EmailIcon />}
            label="Change email"
            active={activeSection === 'email'}
            onClick={() => openSection(activeSection === 'email' ? null : 'email')}
          />
          {activeSection === 'email' && (
            <div style={{ padding: '4px 8px 8px' }}>
              <input
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                type="email"
                autoFocus
                style={inlineInputStyle}
                disabled={emailStatus === 'saving' || emailStatus === 'sent'}
              />
              {emailStatus === 'sent' && (
                <p style={{ fontSize: 11, color: 'var(--green)', margin: '4px 0 6px' }}>
                  Confirmation link sent to new address
                </p>
              )}
              {emailStatus === 'error' && (
                <p style={{ fontSize: 11, color: '#ef4444', margin: '4px 0 6px' }}>{emailError}</p>
              )}
              {emailStatus !== 'sent' && (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, margin: '4px 0 6px' }}>
                    A confirmation link will be sent to the new email address.
                  </p>
                  <button
                    onClick={handleSaveEmail}
                    disabled={emailStatus === 'saving' || !newEmail.trim() || newEmail.trim() === user?.email}
                    style={{ ...inlineSaveBtn, opacity: emailStatus === 'saving' ? 0.6 : 1 }}
                  >
                    {emailStatus === 'saving' ? 'Sending…' : 'Save'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Edit username */}
          <MenuRow
            icon={<AtIcon />}
            label="Edit username"
            active={activeSection === 'username'}
            onClick={() => openSection(activeSection === 'username' ? null : 'username')}
          />
          {activeSection === 'username' && (
            <div style={{ padding: '4px 8px 8px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  autoFocus
                  maxLength={20}
                  style={{
                    ...inlineInputStyle,
                    borderColor: usernameStatus === 'available' || usernameStatus === 'saved' ? 'var(--green)'
                      : usernameStatus === 'taken' || usernameStatus === 'invalid' ? '#ef4444'
                      : 'var(--border)',
                  }}
                  disabled={usernameStatus === 'saving' || usernameStatus === 'saved'}
                />
                <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>
                  {usernameStatus === 'checking' && <MiniSpinner />}
                  {(usernameStatus === 'available' || usernameStatus === 'saved') && (
                    <span style={{ fontSize: 11, color: 'var(--green)' }}>✓</span>
                  )}
                  {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                    <span style={{ fontSize: 11, color: '#ef4444' }}>✗</span>
                  )}
                </div>
              </div>
              {usernameStatus === 'saved' ? (
                <p style={{ fontSize: 11, color: 'var(--green)', margin: '4px 0 0' }}>Username updated!</p>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '4px 0 6px' }}>
                    {usernameStatus === 'invalid' ? '3–20 chars, letters/numbers/underscore'
                      : usernameStatus === 'taken' ? 'Already taken'
                      : '3–20 characters'}
                  </p>
                  <button
                    onClick={handleSaveUsername}
                    disabled={usernameStatus !== 'available'}
                    style={{ ...inlineSaveBtn, opacity: usernameStatus !== 'available' ? 0.5 : 1 }}
                  >
                    {usernameStatus === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Theme toggle */}
          <ThemeRow theme={theme} onToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />

          {/* Divider + sign out */}
          <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
          <SignOutRow onSignOut={handleSignOut} />
        </div>
      )}
    </div>
  )
}

// ─── Menu row ─────────────────────────────────────────────────────────────────

function MenuRow({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7,
        width: '100%', background: hov || active ? 'var(--bg-card)' : 'transparent',
        border: 'none', color: 'var(--text-sec)', fontSize: 13, cursor: 'pointer',
        transition: 'background 0.12s', textAlign: 'left',
      }}
    >
      {icon}{label}
    </button>
  )
}

function SignOutRow({ onSignOut }: { onSignOut: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onSignOut}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7,
        width: '100%', border: 'none', color: '#ef4444', fontSize: 13, cursor: 'pointer',
        background: hov ? 'rgba(239,68,68,0.08)' : 'transparent',
        transition: 'background 0.12s', textAlign: 'left',
      }}
    >
      <LogoutSVG />Sign out
    </button>
  )
}

function ThemeRow({ theme, onToggle }: { theme: string | undefined; onToggle: () => void }) {
  const [hov, setHov] = useState(false)
  const isDark = theme === 'dark'
  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 7,
        width: '100%', background: hov ? 'var(--bg-card)' : 'transparent',
        border: 'none', color: 'var(--text-sec)', fontSize: 13, cursor: 'pointer',
        transition: 'background 0.12s', textAlign: 'left', justifyContent: 'space-between',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isDark ? <MoonIcon /> : <SunIcon />}
        {isDark ? 'Dark mode' : 'Light mode'}
      </span>
      {/* Toggle pill */}
      <span style={{
        display: 'flex', alignItems: 'center',
        width: 32, height: 18, borderRadius: 9,
        background: isDark ? 'var(--accent)' : 'var(--border-light)',
        padding: 2, transition: 'background 0.2s', flexShrink: 0,
      }}>
        <span style={{
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transform: isDark ? 'translateX(14px)' : 'translateX(0)',
          transition: 'transform 0.2s',
        }} />
      </span>
    </button>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function EmailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <path d="M1 5l6 4 6-4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
function AtIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 7a2.5 2.5 0 0 0 2.5 2.5V7a5 5 0 1 0-2 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
function LogoutSVG() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.93 2.93l1.06 1.06M10.01 10.01l1.06 1.06M10.01 3.99l1.06-1.06M2.93 11.07l1.06-1.06"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M11.5 8.5A5 5 0 1 1 5.5 2.5a3.5 3.5 0 0 0 6 6z"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function MiniSpinner() {
  return (
    <svg className="animate-spin" width="11" height="11" viewBox="0 0 11 11" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
      <path d="M5.5 1.5A4 4 0 0 1 9.5 5.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

const inlineInputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)',
  borderRadius: 6, padding: '5px 28px 5px 8px', color: 'var(--text)',
  fontSize: 13, outline: 'none', transition: 'border-color 0.15s',
}
const inlineSaveBtn: React.CSSProperties = {
  background: 'var(--accent)', border: 'none', borderRadius: 6,
  padding: '5px 12px', color: 'white', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', transition: 'opacity 0.15s',
}

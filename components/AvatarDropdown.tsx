'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { avatarInitials } from '@/lib/avatarTheme'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/avatar'
import { ThemePicker } from '@/components/design/ThemePicker'
import { Spinner } from '@/components/ui/Spinner'

type ActiveSection = null | 'email' | 'username'

export function AvatarDropdown() {
  const router = useRouter()
  const { user, profile, signOut, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<ActiveSection>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const [newUsername, setNewUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'saving' | 'saved'>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle')
  const [emailError, setEmailError] = useState('')

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

  const triggerInitials = avatarInitials(profile.username, 'user')

  return (
    <div ref={dropRef} className="relative font-display">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); if (open) setActiveSection(null) }}
        className="size-8 border border-border bg-surface-2 grid place-items-center text-[10px] font-bold uppercase hover:border-ember transition-colors"
      >
        {triggerInitials}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-100 w-[288px] border border-border bg-popover shadow-2xl">
          <div className="px-3 py-3 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
              <UserAvatar seed={profile.username} size={40} kind="user" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground m-0 truncate">@{profile.username}</p>
                <p className="text-xs text-muted-foreground m-0 mt-0.5 truncate">{user?.email}</p>
              </div>
            </div>
          </div>

          <MenuRow
            icon={<EmailIcon />}
            label="Change email"
            active={activeSection === 'email'}
            onClick={() => openSection(activeSection === 'email' ? null : 'email')}
          />
          {activeSection === 'email' && (
            <div className="px-3 pb-3 space-y-2 border-b border-border">
              <input
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                type="email"
                autoFocus
                disabled={emailStatus === 'saving' || emailStatus === 'sent'}
                className="flex h-9 w-full border border-border bg-transparent px-3 py-1 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              />
              {emailStatus === 'sent' && (
                <p className="text-[11px] text-online m-0">Confirmation link sent to new address</p>
              )}
              {emailStatus === 'error' && (
                <p className="text-[11px] text-destructive m-0">{emailError}</p>
              )}
              {emailStatus !== 'sent' && (
                <>
                  <p className="text-[11px] text-muted-foreground m-0 leading-snug">
                    A confirmation link will be sent to the new email address.
                  </p>
                  <Button
                    size="sm"
                    className="uppercase tracking-widest text-[10px] font-bold"
                    onClick={handleSaveEmail}
                    disabled={emailStatus === 'saving' || !newEmail.trim() || newEmail.trim() === user?.email}
                  >
                    {emailStatus === 'saving' ? 'Sending…' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          )}

          <MenuRow
            icon={<AtIcon />}
            label="Edit username"
            active={activeSection === 'username'}
            onClick={() => openSection(activeSection === 'username' ? null : 'username')}
          />
          {activeSection === 'username' && (
            <div className="px-3 pb-3 space-y-2 border-b border-border">
              <div className="relative">
                <input
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  autoFocus
                  maxLength={20}
                  disabled={usernameStatus === 'saving' || usernameStatus === 'saved'}
                  className={`flex h-9 w-full border bg-transparent px-3 py-1 pr-8 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${
                    usernameStatus === 'available' || usernameStatus === 'saved'
                      ? 'border-online'
                      : usernameStatus === 'taken' || usernameStatus === 'invalid'
                        ? 'border-destructive'
                        : 'border-border'
                  }`}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {usernameStatus === 'checking' && <Spinner size={11} tone="muted" />}
                  {(usernameStatus === 'available' || usernameStatus === 'saved') && (
                    <span className="text-[11px] text-online">✓</span>
                  )}
                  {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                    <span className="text-[11px] text-destructive">✗</span>
                  )}
                </div>
              </div>
              {usernameStatus === 'saved' ? (
                <p className="text-[11px] text-online m-0">Username updated!</p>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground m-0">
                    {usernameStatus === 'invalid' ? '3–20 chars, letters/numbers/underscore'
                      : usernameStatus === 'taken' ? 'Already taken'
                      : '3–20 characters'}
                  </p>
                  <Button
                    size="sm"
                    className="uppercase tracking-widest text-[10px] font-bold"
                    onClick={handleSaveUsername}
                    disabled={usernameStatus !== 'available'}
                  >
                    {usernameStatus === 'saving' ? 'Saving…' : 'Save'}
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="px-3 py-2 border-b border-border">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground m-0">Theme</p>
          </div>
          <ThemePicker />

          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 text-xs text-destructive hover:text-destructive hover:bg-surface px-3 font-normal"
              onClick={handleSignOut}
            >
              <LogoutIcon />
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuRow({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={`w-full justify-start gap-2.5 px-3 py-2 h-auto text-sm font-normal rounded-none ${
        active ? 'bg-surface text-foreground' : 'text-foreground'
      }`}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      {label}
    </Button>
  )
}

function EmailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="3" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
      <path d="M1 5l6 4 6-4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function AtIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 7a2.5 2.5 0 0 0 2.5 2.5V7a5 5 0 1 0-2 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

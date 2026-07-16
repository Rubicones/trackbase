'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AtSign, CreditCard, LogOut, Mail, Trash2, X, type IconNode } from 'lucide'
import { useAuth } from '@/contexts/AuthContext'
import { usePaywall } from '@/contexts/PaywallContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { setAuthCookies, clearAuthCookies } from '@/lib/auth/cookies'
import { UserAvatar } from '@/components/ui/avatar'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbModal } from '@/components/design/TbModal'
import { TbButton } from '@/components/design/TbButton'
import { TbInput } from '@/components/design/TbInput'
import { Spinner } from '@/components/ui/Spinner'

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'saving' | 'saved'
type EmailStatus = 'idle' | 'saving' | 'sent' | 'error'
type DeleteStep = 'idle' | 'warn' | 'confirm'

export function PreferencesModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { user, profile, signOut, refreshProfile } = useAuth()
  const { enabled: paywallEnabled, setEnabled: setPaywallEnabled } = usePaywall()

  const [newUsername, setNewUsername] = useState(profile?.username ?? '')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const usernameDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [newEmail, setNewEmail] = useState(user?.email ?? '')
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle')
  const [emailError, setEmailError] = useState('')

  const [deleteStep, setDeleteStep] = useState<DeleteStep>('idle')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteAck, setDeleteAck] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    setNewUsername(profile?.username ?? '')
    setUsernameStatus('idle')
  }, [profile?.username])

  useEffect(() => {
    setNewEmail(user?.email ?? '')
    setEmailStatus('idle')
    setEmailError('')
  }, [user?.email])

  useEffect(() => {
    if (usernameDebounce.current) clearTimeout(usernameDebounce.current)
    const clean = newUsername.trim().toLowerCase()
    if (!clean || clean === profile?.username) {
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
  }, [newUsername, profile?.username])

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
      if (session) void setAuthCookies(session)
      await refreshProfile()
      setUsernameStatus('saved')
      setTimeout(() => setUsernameStatus('idle'), 1500)
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
    setSigningOut(true)
    try {
      await signOut()
      onClose()
      router.replace('/auth')
    } finally {
      setSigningOut(false)
    }
  }

  async function handleDeleteAccount() {
    if (!profile || deleteConfirm.trim().toLowerCase() !== profile.username.toLowerCase() || !deleteAck) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/profile/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmUsername: deleteConfirm.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to delete account')

      const supabase = getSupabaseClient()
      await supabase.auth.signOut({ scope: 'local' })
      await clearAuthCookies()
      onClose()
      router.replace('/auth')
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  if (!profile) return null

  const usernameHint =
    usernameStatus === 'saved' ? 'Username updated'
      : usernameStatus === 'invalid' ? '3–20 chars · letters, numbers, underscore'
        : usernameStatus === 'taken' ? 'That username is taken'
          : usernameStatus === 'available' ? 'Available'
            : usernameStatus === 'checking' ? 'Checking…'
              : '3–20 characters'

  const usernameHintTone =
    usernameStatus === 'saved' || usernameStatus === 'available' ? 'text-online'
      : usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'text-destructive'
        : 'text-muted-foreground'

  return (
    <TbModal
      onClose={onClose}
      wide
      className="max-w-[460px]! p-0! max-h-[min(90vh,680px)] overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border px-5 py-4 flex items-center gap-3">
        <UserAvatar seed={profile.username} size={40} kind="user" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] uppercase tracking-tight text-foreground m-0 leading-none">
            Preferences
          </h2>
          <p className="font-mono text-[11px] text-muted-foreground m-0 mt-1.5 truncate">
            @{profile.username}
            {user?.email ? <span className="text-border mx-1.5">·</span> : null}
            {user?.email ? <span className="truncate">{user.email}</span> : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preferences"
          className="size-8 grid place-items-center border border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors shrink-0"
        >
          <LucideIcon icon={X} size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile */}
        <section className="px-5 py-5 border-b border-border">
          <SectionEyebrow>Profile</SectionEyebrow>

          <FieldLabel htmlFor="prefs-username" icon={AtSign}>
            Username
          </FieldLabel>
          <div className="relative mb-1.5">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
              @
            </span>
            <TbInput
              id="prefs-username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              maxLength={20}
              autoComplete="username"
              disabled={usernameStatus === 'saving' || usernameStatus === 'saved'}
              className={`pl-7 font-mono ${
                usernameStatus === 'available' || usernameStatus === 'saved'
                  ? 'border-online'
                  : usernameStatus === 'taken' || usernameStatus === 'invalid'
                    ? 'border-destructive'
                    : ''
              }`}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {usernameStatus === 'checking' && <Spinner size={12} tone="muted" />}
              {(usernameStatus === 'available' || usernameStatus === 'saved') && (
                <span className="text-[11px] text-online font-mono">✓</span>
              )}
              {(usernameStatus === 'taken' || usernameStatus === 'invalid') && (
                <span className="text-[11px] text-destructive font-mono">✗</span>
              )}
            </div>
          </div>
          <p className={`font-mono text-[10px] m-0 mb-3 ${usernameHintTone}`}>{usernameHint}</p>
          <TbButton
            variant="primary"
            onClick={handleSaveUsername}
            disabled={usernameStatus !== 'available'}
          >
            {usernameStatus === 'saving' ? 'Saving…' : 'Save username'}
          </TbButton>

          <div className="h-px bg-border my-5" />

          <FieldLabel htmlFor="prefs-email" icon={Mail}>
            Email
          </FieldLabel>
          <TbInput
            id="prefs-email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            type="email"
            autoComplete="email"
            disabled={emailStatus === 'saving' || emailStatus === 'sent'}
            className="mb-1.5 font-mono text-[13px]"
          />
          {emailStatus === 'sent' ? (
            <p className="font-mono text-[10px] text-online m-0 mb-3">
              Confirmation link sent — check the new inbox
            </p>
          ) : emailStatus === 'error' ? (
            <p className="font-mono text-[10px] text-destructive m-0 mb-3">{emailError}</p>
          ) : (
            <p className="font-mono text-[10px] text-muted-foreground m-0 mb-3 leading-relaxed">
              We&apos;ll send a confirmation link. Your current address stays active until you confirm.
            </p>
          )}
          {emailStatus !== 'sent' && (
            <TbButton
              variant="primary"
              onClick={handleSaveEmail}
              disabled={emailStatus === 'saving' || !newEmail.trim() || newEmail.trim() === user?.email}
            >
              {emailStatus === 'saving' ? 'Sending…' : 'Update email'}
            </TbButton>
          )}
        </section>

        {/* Session */}
        <section className="px-5 py-5 border-b border-border">
          <SectionEyebrow>Session</SectionEyebrow>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-foreground m-0 mb-1 flex items-center gap-2">
                <LucideIcon icon={LogOut} size={14} className="text-muted-foreground shrink-0" />
                Sign out
              </p>
              <p className="font-mono text-[10px] text-muted-foreground m-0 leading-relaxed">
                Ends this device session. Sign back in anytime with a magic link.
              </p>
            </div>
            <TbButton
              variant="ghost"
              onClick={handleSignOut}
              disabled={signingOut}
              className="shrink-0"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </TbButton>
          </div>
        </section>

        {/* Testing */}
        <section className="px-5 py-5 border-b border-border">
          <SectionEyebrow>Testing</SectionEyebrow>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-foreground m-0 mb-1 flex items-center gap-2">
                <LucideIcon icon={CreditCard} size={14} className="text-muted-foreground shrink-0" />
                Show paywall
              </p>
              <p className="font-mono text-[10px] text-muted-foreground m-0 leading-relaxed">
                Preview subscription gating (testing only)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={paywallEnabled}
              aria-label="Show paywall"
              onClick={() => setPaywallEnabled(!paywallEnabled)}
              className={`relative h-5 w-9 shrink-0 border transition-colors ${
                paywallEnabled ? 'border-lime bg-lime/20' : 'border-border bg-surface'
              }`}
            >
              <span
                className={`absolute top-1/2 -translate-y-1/2 size-3 transition-[left,background-color] duration-150 ${
                  paywallEnabled ? 'left-[calc(100%-1rem)] bg-lime' : 'left-1 bg-muted-foreground'
                }`}
                aria-hidden
              />
            </button>
          </div>
        </section>

        {/* Danger zone */}
        <section className="px-5 py-5">
          <SectionEyebrow tone="danger">Danger zone</SectionEyebrow>

          {deleteStep === 'idle' && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-foreground m-0 mb-1 flex items-center gap-2">
                  <LucideIcon icon={Trash2} size={14} className="text-destructive shrink-0" />
                  Delete account
                </p>
                <p className="font-mono text-[10px] text-muted-foreground m-0 leading-relaxed">
                  Permanently erase your account and sole-owned band data. Irreversible.
                </p>
              </div>
              <TbButton
                variant="menuDanger"
                onClick={() => setDeleteStep('warn')}
                className="shrink-0"
              >
                Delete…
              </TbButton>
            </div>
          )}

          {deleteStep === 'warn' && (
            <div className="border border-destructive/35 bg-destructive/5 p-4">
              <p className="font-display text-sm uppercase tracking-tight text-destructive m-0 mb-3">
                Read carefully
              </p>
              <ul className="m-0 mb-4 pl-0 list-none space-y-2.5">
                {[
                  'Your account, profile, and sign-in will be permanently erased.',
                  'Any band you solely own will be deleted — projects, versions, tracks, comments, and audio.',
                  'You will be removed from every other band you belong to.',
                  'There is no recovery, export, or grace period.',
                ].map(line => (
                  <li key={line} className="flex items-start gap-2.5 font-mono text-[11px] text-muted-foreground leading-snug">
                    <span className="size-1 bg-destructive shrink-0 mt-1.5" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 justify-end">
                <TbButton onClick={() => setDeleteStep('idle')}>Cancel</TbButton>
                <TbButton
                  variant="danger"
                  onClick={() => {
                    setDeleteStep('confirm')
                    setDeleteConfirm('')
                    setDeleteAck(false)
                    setDeleteError('')
                  }}
                >
                  I understand — continue
                </TbButton>
              </div>
            </div>
          )}

          {deleteStep === 'confirm' && (
            <div className="border border-destructive/35 bg-destructive/5 p-4 space-y-3">
              <p className="font-display text-sm uppercase tracking-tight text-destructive m-0">
                Final confirmation
              </p>
              <p className="font-mono text-[11px] text-muted-foreground m-0 leading-relaxed">
                Type <span className="text-foreground">@{profile.username}</span> to confirm.
                Sole-owned bands and all their content will be destroyed immediately.
              </p>
              <TbInput
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={profile.username}
                autoFocus
                disabled={deleting}
                className="font-mono"
                autoComplete="off"
              />
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteAck}
                  onChange={e => setDeleteAck(e.target.checked)}
                  disabled={deleting}
                  className="mt-0.5 size-3.5 accent-destructive shrink-0"
                />
                <span className="font-mono text-[10px] text-muted-foreground leading-relaxed">
                  I understand this is permanent. Delete my account and all sole-owned band data.
                </span>
              </label>
              {deleteError && (
                <p className="font-mono text-[11px] text-destructive m-0">{deleteError}</p>
              )}
              <div className="flex gap-2 justify-end pt-1">
                <TbButton
                  onClick={() => {
                    setDeleteStep('idle')
                    setDeleteConfirm('')
                    setDeleteAck(false)
                    setDeleteError('')
                  }}
                  disabled={deleting}
                >
                  Cancel
                </TbButton>
                <TbButton
                  variant="danger"
                  onClick={handleDeleteAccount}
                  disabled={
                    deleting ||
                    !deleteAck ||
                    deleteConfirm.trim().toLowerCase() !== profile.username.toLowerCase()
                  }
                >
                  {deleting ? 'Deleting…' : 'Permanently delete'}
                </TbButton>
              </div>
            </div>
          )}
        </section>
      </div>
    </TbModal>
  )
}

function SectionEyebrow({
  children,
  tone = 'default',
}: {
  children: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <p
      className={`font-mono text-[9px] uppercase tracking-[0.14em] m-0 mb-4 ${
        tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'
      }`}
    >
      {children}
    </p>
  )
}

function FieldLabel({
  children,
  htmlFor,
  icon,
}: {
  children: ReactNode
  htmlFor: string
  icon: IconNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground m-0 mb-2"
    >
      <LucideIcon icon={icon} size={12} className="opacity-70" />
      {children}
    </label>
  )
}

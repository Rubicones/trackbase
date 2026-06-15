'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  AuthShell,
  AuthCard,
  AuthCardHeader,
  AuthCardBody,
  AuthWaveAccent,
  AuthLoadingScreen,
} from '@/components/auth/AuthShell'
import { AuthButton } from '@/components/auth/AuthPrimitives'
import { Spinner } from '@/components/ui/Spinner'

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
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
      setStatus('success')
      setTimeout(() => router.push(`/band/${data.band_id}`), 1200)
    } catch {
      setMessage('Network error. Please try again.')
      setStatus('error')
    }
  }

  if (authLoading || !user) {
    return <AuthLoadingScreen label="Redirecting" />
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthWaveAccent />

        {status === 'success' ? (
          <>
            <AuthCardHeader
              tag="03 // Invite"
              title="You're in"
              subtitle="Redirecting you to the band…"
            />
            <AuthCardBody className="flex flex-col items-center gap-4 text-center">
              <div className="size-14 border border-online/40 bg-online/10 grid place-items-center text-online">
                <CheckIcon />
              </div>
              <Spinner size={20} tone="muted" />
            </AuthCardBody>
          </>
        ) : status === 'error' ? (
          <>
            <AuthCardHeader
              tag="03 // Invite"
              title="Invalid invite"
              subtitle={message}
            />
            <AuthCardBody className="space-y-4 text-center">
              <div className="mx-auto size-14 border border-destructive/40 bg-destructive/10 grid place-items-center text-destructive">
                <XIcon />
              </div>
              <AuthButton onClick={() => router.push('/dashboard')}>
                Go to dashboard →
              </AuthButton>
            </AuthCardBody>
          </>
        ) : (
          <>
            <AuthCardHeader
              tag="03 // Invite"
              title="You're invited"
              subtitle="Someone invited you to join their band on Trackbase."
            />
            <AuthCardBody className="space-y-4 text-center">
              <div className="mx-auto size-14 border border-ember/40 bg-ember-soft/30 grid place-items-center text-ember">
                <InviteIcon />
              </div>
              <AuthButton
                onClick={handleAccept}
                disabled={status === 'accepting'}
              >
                {status === 'accepting' ? 'Joining…' : 'Accept invite →'}
              </AuthButton>
            </AuthCardBody>
          </>
        )}
      </AuthCard>
    </AuthShell>
  )
}

function CheckIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12l5 5 9-10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 7l10 10M17 7L7 17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function InviteIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 12h8M8 9h5M8 15h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

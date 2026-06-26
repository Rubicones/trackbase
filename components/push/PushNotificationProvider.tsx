'use client'

import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/lib/analytics'
import { useAuth } from '@/contexts/AuthContext'
import { PushPermissionModal } from '@/components/push/PushPermissionModal'
import {
  registerServiceWorker,
  shouldShowAutoPrompt,
  syncExistingSubscription,
} from '@/lib/push/client'

export function PushNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const promptedRef = useRef(false)

  useEffect(() => {
    void registerServiceWorker()
  }, [])

  useEffect(() => {
    if (loading || !user) return
    void syncExistingSubscription()
  }, [loading, user])

  useEffect(() => {
    if (loading || !user || promptedRef.current) return
    if (!shouldShowAutoPrompt()) return
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return

    promptedRef.current = true
    const timer = window.setTimeout(() => {
      setShowModal(true)
      trackEvent('push_prompt_shown', { source: 'auto' })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [loading, user])

  return (
    <>
      {children}
      <PushPermissionModal open={showModal} onClose={() => setShowModal(false)} />
    </>
  )
}

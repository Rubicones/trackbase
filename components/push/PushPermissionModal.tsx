'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, UserPlus, AtSign, Check } from 'lucide'
import { trackEvent } from '@/lib/analytics'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbModal } from '@/components/design/TbModal'
import { TbButton } from '@/components/design/TbButton'
import {
  markPermissionDeferred,
  markPermissionDenied,
  markPermissionGranted,
  subscribeToPush,
} from '@/lib/push/client'

type ModalPhase = 'prompt' | 'success' | 'denied'

export function PushPermissionModal({
  open,
  onClose,
  onSubscribed,
}: {
  open: boolean
  onClose: () => void
  onSubscribed?: () => void
}) {
  const [phase, setPhase] = useState<ModalPhase>('prompt')
  const [enabling, setEnabling] = useState(false)

  useEffect(() => {
    if (open) setPhase('prompt')
  }, [open])

  const handleEnable = useCallback(async () => {
    setEnabling(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        await subscribeToPush()
        markPermissionGranted()
        trackEvent('push_enabled')
        setPhase('success')
        onSubscribed?.()
        setTimeout(onClose, 1500)
      } else {
        markPermissionDenied()
        trackEvent('push_declined', { reason: 'denied' })
        setPhase('denied')
      }
    } finally {
      setEnabling(false)
    }
  }, [onClose, onSubscribed])

  const handleLater = useCallback(() => {
    markPermissionDeferred()
    trackEvent('push_declined', { reason: 'deferred' })
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <TbModal onClose={onClose}>
      {phase === 'success' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <LucideIcon icon={Check} size={40} className="text-online" strokeWidth={2} />
          <p className="m-0 font-display text-sm uppercase tracking-tight text-foreground">
            You&apos;re all set
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center text-center mb-5">
            <LucideIcon icon={Bell} size={40} className="text-lime mb-3" strokeWidth={1.75} />
            <h2 className="m-0 font-display text-lg uppercase tracking-tight text-foreground">
              Stay in the loop
            </h2>
          </div>

          <p className="text-sm text-muted-foreground m-0 mb-3">Get notified when:</p>

          <ul className="space-y-2.5 mb-4 list-none p-0 m-0">
            <li className="flex items-center gap-2.5 text-sm text-foreground">
              <LucideIcon icon={UserPlus} size={16} className="text-muted-foreground shrink-0" />
              Someone requests to join your band
            </li>
            <li className="flex items-center gap-2.5 text-sm text-foreground">
              <LucideIcon icon={AtSign} size={16} className="text-muted-foreground shrink-0" />
              You&apos;re @mentioned in a chat
            </li>
          </ul>

          <p className="text-[12px] text-muted-foreground/80 leading-relaxed m-0 mb-5">
            That&apos;s it. No promotional messages, no spam.
            You can turn this off anytime in your browser settings.
          </p>

          {phase === 'denied' && (
            <p className="text-xs text-destructive/90 mb-4 m-0 leading-relaxed">
              Notifications blocked. To enable, update your browser&apos;s site settings for this page.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <TbButton variant="ghost" className="w-full sm:w-auto" onClick={handleLater}>
              Maybe later
            </TbButton>
            <TbButton
              variant="primary"
              className="w-full sm:w-auto"
              onClick={handleEnable}
              disabled={enabling}
            >
              {enabling ? 'Enabling…' : 'Enable notifications'}
            </TbButton>
          </div>
        </>
      )}
    </TbModal>
  )
}

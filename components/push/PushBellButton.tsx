'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellOff } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import { TbButton } from '@/components/design/TbButton'
import { PushPermissionModal } from '@/components/push/PushPermissionModal'
import {
  getPushSubscription,
  isPushSupported,
  unsubscribeFromPush,
} from '@/lib/push/client'

type BellStatus = 'default' | 'subscribed' | 'blocked'

export function PushBellButton() {
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<BellStatus>('default')
  const [showModal, setShowModal] = useState(false)
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const refreshStatus = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus('blocked')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('blocked')
      return
    }
    const sub = await getPushSubscription()
    setStatus(sub ? 'subscribed' : 'default')
  }, [])

  useEffect(() => {
    setMounted(true)
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!showPopover) return
    function onDocClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [showPopover])

  // Return null until mounted so SSR and client first render match
  if (!mounted || !isPushSupported()) return null

  const icon = status === 'subscribed' ? Bell : status === 'blocked' ? BellOff : Bell
  const iconClass =
    status === 'subscribed'
      ? 'text-ember fill-ember/20'
      : status === 'blocked'
        ? 'text-muted-foreground/50'
        : 'text-muted-foreground'

  function handleClick() {
    if (status === 'subscribed') {
      setShowPopover(p => !p)
      return
    }
    setShowModal(true)
  }

  async function handleTurnOff() {
    await unsubscribeFromPush()
    setShowPopover(false)
    await refreshStatus()
  }

  return (
    <>
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={handleClick}
          aria-label={
            status === 'subscribed'
              ? 'Notifications on'
              : status === 'blocked'
                ? 'Notifications off'
                : 'Enable notifications'
          }
          className="size-8 grid place-items-center border-0 bg-transparent text-muted-foreground hover:text-ember transition cursor-pointer"
        >
          <LucideIcon icon={icon} size={16} className={iconClass} strokeWidth={status === 'subscribed' ? 2 : 1.75} />
        </button>

        {showPopover && (
          <div className="absolute right-0 top-full mt-2 z-[100] w-64 border border-border bg-popover shadow-2xl p-4">
            <p className="m-0 text-xs font-bold text-foreground">Notifications are on</p>
            <p className="m-0 mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
              You&apos;ll be notified about join requests and @mentions
            </p>
            <TbButton
              variant="ghost"
              className="mt-3 w-full"
              onClick={() => void handleTurnOff()}
            >
              Turn off
            </TbButton>
          </div>
        )}
      </div>

      <PushPermissionModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSubscribed={() => void refreshStatus()}
      />
    </>
  )
}

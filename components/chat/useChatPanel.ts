'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'tb-chat-open'

function shouldRestoreOpenFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (localStorage.getItem(STORAGE_KEY) !== '1') return false
    // Mobile uses the bottom CHAT bar; restoring open hides the rail and can
    // leave the panel behind the z-[200] mobile shell on refresh.
    return window.matchMedia('(min-width: 1024px)').matches
  } catch {
    return false
  }
}

/** Per-session open/closed state for the chat dock, persisted to localStorage. */
export function useChatPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (shouldRestoreOpenFromStorage()) setOpen(true)
  }, [])

  const persist = useCallback((value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const openChat = useCallback(() => {
    setOpen(true)
    persist(true)
  }, [persist])

  const closeChat = useCallback(() => {
    setOpen(false)
    persist(false)
  }, [persist])

  return { open, openChat, closeChat }
}

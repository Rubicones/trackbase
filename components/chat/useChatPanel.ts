'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'tb-chat-open'

/** Per-session open/closed state for the chat dock, persisted to localStorage. */
export function useChatPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      /* ignore */
    }
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

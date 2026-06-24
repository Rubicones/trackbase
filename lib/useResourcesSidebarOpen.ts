'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'tb-resources-open'

function readStored(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

/** Sidebar resources panel open/closed — persisted globally across projects. */
export function useResourcesSidebarOpen() {
  const [open, setOpenState] = useState(true)

  useEffect(() => {
    setOpenState(readStored())
  }, [])

  const setOpen = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setOpenState(prev => {
      const next = typeof value === 'function' ? value(prev) : value
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const toggle = useCallback(() => {
    setOpen(prev => !prev)
  }, [setOpen])

  return { open, setOpen, toggle }
}

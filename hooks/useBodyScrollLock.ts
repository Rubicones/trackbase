'use client'

import { useEffect } from 'react'
import { lockBodyScroll } from '@/lib/bodyScrollLock'

/** Lock document scroll while `locked` is true (e.g. modal open). */
export function useBodyScrollLock(locked = true) {
  useEffect(() => {
    if (!locked) return
    return lockBodyScroll()
  }, [locked])
}

'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'

type ScrollSyncCtx = {
  register: (el: HTMLDivElement) => () => void
  syncTo: (scrollLeft: number, source?: HTMLDivElement) => void
  getScrollLeft: () => number
  getSampleEl: () => HTMLDivElement | null
}

const Ctx = createContext<ScrollSyncCtx | null>(null)

export function MobileTimelineScrollProvider({ children }: { children: ReactNode }) {
  const elsRef = useRef(new Set<HTMLDivElement>())
  const scrollLeftRef = useRef(0)
  const syncingRef = useRef(false)

  const syncTo = useCallback((scrollLeft: number, source?: HTMLDivElement) => {
    scrollLeftRef.current = scrollLeft
    if (syncingRef.current) return
    syncingRef.current = true
    for (const el of elsRef.current) {
      if (el !== source) el.scrollLeft = scrollLeft
    }
    syncingRef.current = false
  }, [])

  const register = useCallback((el: HTMLDivElement) => {
    elsRef.current.add(el)
    el.scrollLeft = scrollLeftRef.current
    const onScroll = () => {
      if (syncingRef.current) return
      syncTo(el.scrollLeft, el)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      elsRef.current.delete(el)
    }
  }, [syncTo])

  const value: ScrollSyncCtx = {
    register,
    syncTo,
    getScrollLeft: () => scrollLeftRef.current,
    getSampleEl: () => {
      for (const el of elsRef.current) return el
      return null
    },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useMobileTimelineScroll() {
  return useContext(Ctx)
}

export function useRegisterTimelineScroll(ref: RefObject<HTMLDivElement | null>) {
  const ctx = useMobileTimelineScroll()
  useEffect(() => {
    const el = ref.current
    if (!el || !ctx) return
    return ctx.register(el)
  }, [ref, ctx])
}

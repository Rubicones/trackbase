'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { stopAllPlayback } from '@/lib/playbackSession'

/** Stops any active preview/mixer playback when navigating away. */
export function NavigationPlaybackCleanup() {
  const pathname = usePathname()

  useEffect(() => {
    stopAllPlayback()
  }, [pathname])

  return null
}

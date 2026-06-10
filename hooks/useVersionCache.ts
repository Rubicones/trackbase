import { useRef } from 'react'
import type { Track, TrackComment } from '@/lib/types'

export interface VersionData {
  tracks: Track[]
  comments: Record<string, TrackComment[]> // keyed by track_id
  fetchedAt: number
}

export function useVersionCache() {
  const cache = useRef<Record<string, VersionData>>({})

  /** Return cached data for a version, or null if not yet loaded. */
  const getVersion = (versionId: string): VersionData | null =>
    cache.current[versionId] ?? null

  /** Store version data in cache. */
  const setVersion = (versionId: string, data: VersionData): void => {
    cache.current[versionId] = data
    console.log('[cache] set:', versionId)
  }

  /** Remove a version from cache so next access triggers a fresh fetch. */
  const invalidate = (versionId: string): void => {
    delete cache.current[versionId]
    console.log('[cache] invalidated:', versionId)
  }

  /**
   * Update comments for a specific track in-place without invalidating the
   * whole version. Use this for comment add / delete so we don't need to
   * re-fetch the entire version just because one comment changed.
   */
  const patchComments = (
    versionId: string,
    trackId: string,
    updater: (comments: TrackComment[]) => TrackComment[]
  ): void => {
    const data = cache.current[versionId]
    if (!data) return
    cache.current[versionId] = {
      ...data,
      comments: {
        ...data.comments,
        [trackId]: updater(data.comments[trackId] ?? []),
      },
    }
  }

  return { getVersion, setVersion, invalidate, patchComments }
}

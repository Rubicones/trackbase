'use client'

import { useEffect, useState } from 'react'
import type { MergePreview, MergeResolution } from '@/lib/mergePreview'

export function useMergePreview(
  projectId: string,
  branchId: string,
  targetVersionId: string,
) {
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!branchId || !targetVersionId) return

    let cancelled = false
    setLoading(true)
    setError('')
    setPreview(null)

    fetch(`/api/projects/${projectId}/merge/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch_id: branchId, target_version_id: targetVersionId }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to load merge preview')
        }
        return res.json() as Promise<MergePreview>
      })
      .then(data => {
        if (!cancelled) setPreview(data)
      })
      .catch(err => {
        if (!cancelled) {
          setPreview(null)
          setError(err instanceof Error ? err.message : 'Failed to load merge preview')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [projectId, branchId, targetVersionId])

  return { preview, loading, error }
}

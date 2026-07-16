/**
 * Shared project-scoped GET helpers with in-flight coalescing.
 * Collapses Strict Mode remounts and overlapping callers (ResourcesCard × Sidebar
 * swap, checklist + chat members, etc.) onto one network request each.
 */

import { fetchJsonInflight, invalidateInflightCache } from '@/lib/inflightJson'

const SHORT_TTL_MS = 15_000

export function invalidateProjectData(projectId: string) {
  invalidateInflightCache(`/api/projects/${projectId}`)
}

export function fetchProjectJson<T = Record<string, unknown>>(
  projectId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/projects/${projectId}`, { ttlMs: SHORT_TTL_MS, signal })
}

export function fetchProjectResourcesJson<T = { resources: unknown[] }>(
  projectId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/projects/${projectId}/resources`, {
    ttlMs: SHORT_TTL_MS,
    signal,
  })
}

export function fetchProjectChecklistJson<T = { items: unknown[] }>(
  projectId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/projects/${projectId}/checklist`, {
    ttlMs: SHORT_TTL_MS,
    signal,
  })
}

export function fetchProjectRoadmapJson<T = Record<string, unknown>>(
  projectId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/projects/${projectId}/roadmap`, {
    ttlMs: SHORT_TTL_MS,
    signal,
  })
}

export function fetchProjectStorageJson<T = { used_bytes?: number; limit_bytes?: number }>(
  projectId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/projects/${projectId}/storage`, {
    ttlMs: SHORT_TTL_MS,
    signal,
  })
}

export function fetchVersionSectionsJson<T = { sections?: unknown[] }>(
  versionId: string,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJsonInflight<T>(`/api/versions/${versionId}/sections`, {
    ttlMs: SHORT_TTL_MS,
    signal,
  })
}

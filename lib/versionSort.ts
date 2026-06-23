import type { Version } from '@/lib/types'

/** Mobile version bar: main first, then branches newest-first. */
export function sortMobileVersions(versions: Version[]): Version[] {
  return [...versions].sort((a, b) => {
    if (a.type === 'main' && b.type !== 'main') return -1
    if (b.type === 'main' && a.type !== 'main') return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

/** Open merge targets for a branch (excludes self and merged branches). */
export function mergeTargetVersions(versions: Version[], branchId: string): Version[] {
  return versions.filter(v => v.id !== branchId && !v.merged_at)
}

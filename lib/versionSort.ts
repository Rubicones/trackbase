import type { Version } from '@/lib/types'

/**
 * Returns the display name for a version.
 * Versions with type='main' and name='main' (legacy rows created before the
 * rename) are shown as "Master" so the UI is consistent without a migration.
 */
export function getVersionDisplayName(version: Pick<Version, 'name' | 'type'>): string {
  if (version.type === 'main' && version.name === 'main') return 'Master'
  return version.name
}

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

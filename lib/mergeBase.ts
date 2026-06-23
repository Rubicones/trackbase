/** Minimal version fields needed to walk the branch tree. */
export interface VersionParentLink {
  id: string
  parent_id: string | null
}

/**
 * Lowest common ancestor of `branch` and `targetId` in the parent_id tree.
 *
 * Used as the three-way merge base so nested branches (e.g. main → A → B merged
 * into main) diff against the target lineage, not only the immediate parent.
 *
 * Examples (parent chain only):
 *   main ← A ← B, merge B → main  → main
 *   main ← A ← B, merge B → A     → A
 *   main ← C, main ← A, merge C → A → main
 */
export function findMergeBaseVersionId(
  branch: VersionParentLink,
  targetId: string,
  versionsById: ReadonlyMap<string, VersionParentLink>,
): string | null {
  const branchAncestorIds: string[] = []
  let cursor = branch.parent_id
  while (cursor) {
    branchAncestorIds.push(cursor)
    cursor = versionsById.get(cursor)?.parent_id ?? null
  }

  const targetAncestorIds = new Set<string>()
  let targetCursor: string | null = targetId
  while (targetCursor) {
    targetAncestorIds.add(targetCursor)
    targetCursor = versionsById.get(targetCursor)?.parent_id ?? null
  }

  // Closest shared ancestor first (parent before grandparent).
  for (const ancestorId of branchAncestorIds) {
    if (targetAncestorIds.has(ancestorId)) return ancestorId
  }

  return null
}

export function buildVersionParentMap(
  versions: readonly VersionParentLink[],
): Map<string, VersionParentLink> {
  return new Map(versions.map(v => [v.id, v]))
}

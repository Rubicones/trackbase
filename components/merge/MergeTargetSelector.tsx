'use client'

import { VersionChipSelector } from '@/components/VersionChipSelector'
import type { Version } from '@/lib/types'
import { mergeTargetVersions } from '@/lib/versionSort'
import { SpinnerBars } from '@/components/ui/Spinner'

export function MergeTargetSelector({
  branchId,
  versions,
  targetId,
  onTargetChange,
  disabled = false,
}: {
  branchId: string
  versions: Version[]
  targetId: string
  onTargetChange: (id: string) => void
  disabled?: boolean
}) {
  const targets = mergeTargetVersions(versions, branchId)

  return (
    <VersionChipSelector
      versions={targets}
      selectedId={targetId}
      onChange={onTargetChange}
      disabled={disabled}
      popoverLabel="Apply to"
      showPlus
    />
  )
}

export function MergePreviewLoading({ label = 'Comparing changes…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
      <SpinnerBars />
      <span>{label}</span>
    </div>
  )
}

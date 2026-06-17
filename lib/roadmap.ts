export type RoadmapStep = {
  id: string
  name: string
  position: number
}

export type ProjectRoadmap = {
  steps: RoadmapStep[]
  stepIndex: number | null
  stageSince: string | null
  configured: boolean
}

export function stageStuckLevel(stageSince: string): 'fresh' | 'ok' | 'stale' {
  const days = (Date.now() - new Date(stageSince).getTime()) / 86_400_000
  if (days < 3) return 'fresh'
  if (days < 14) return 'ok'
  return 'stale'
}

export function formatRelativeStage(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const day = 86_400_000
  if (diff < day) {
    const h = Math.max(1, Math.round(diff / 3_600_000))
    return h <= 1 ? 'just now' : `${h}h ago`
  }
  const d = Math.round(diff / day)
  if (d < 14) return `${d}d ago`
  return `${Math.round(d / 7)}w ago`
}

export function shortStepName(name: string, max = 8): string {
  const trimmed = name.trim()
  if (trimmed.length <= max) return trimmed.toUpperCase()
  return `${trimmed.slice(0, max - 1).toUpperCase()}…`
}

// roadmap_step_index = count of completed steps (0..steps.length inclusive).
export function roadmapProgress(stepIndex: number | null, stepCount: number) {
  const completedCount = Math.min(Math.max(0, stepIndex ?? 0), stepCount)
  const allDone = stepCount > 0 && completedCount >= stepCount
  const currentIndex = allDone ? stepCount - 1 : completedCount
  return { completedCount, allDone, currentIndex, stepCount }
}

export function roadmapStepState(
  index: number,
  completedCount: number,
  stepCount: number,
): 'done' | 'current' | 'ahead' {
  if (index < completedCount) return 'done'
  if (completedCount < stepCount && index === completedCount) return 'current'
  return 'ahead'
}

export function roadmapStageLabel(completedCount: number, stepCount: number, allDone: boolean): string {
  if (stepCount === 0) return '0 / 0'
  if (allDone) return `${stepCount} / ${stepCount}`
  return `${completedCount + 1} / ${stepCount}`
}

export function roadmapLineFillPercent(completedCount: number, stepCount: number, allDone: boolean): number {
  if (stepCount <= 1) return allDone ? 100 : 0
  if (allDone) return 100
  return (completedCount / (stepCount - 1)) * 100
}

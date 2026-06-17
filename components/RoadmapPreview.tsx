'use client'

import type { RoadmapStep } from '@/lib/roadmap'
import { formatRelativeStage, roadmapProgress, roadmapStageLabel, roadmapStepState } from '@/lib/roadmap'

// Segmented progress bar — used on project cards and compact headers.
export function RoadmapPreview({
  steps,
  stepIndex,
  stageSince,
  className = '',
  showCaption = false,
  animate = false,
  animateBaseDelayMs = 0,
}: {
  steps: Pick<RoadmapStep, 'name'>[]
  stepIndex: number
  stageSince?: string | null
  className?: string
  showCaption?: boolean
  animate?: boolean
  /** Stagger after parent row entrance (ms). */
  animateBaseDelayMs?: number
}) {
  if (steps.length === 0 || stepIndex < 0) return null

  const { completedCount, allDone, currentIndex } = roadmapProgress(stepIndex, steps.length)
  const current = steps[currentIndex]

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={
        stageSince
          ? `Stage ${roadmapStageLabel(completedCount, steps.length, allDone)} · ${allDone ? 'Complete' : current.name} · since ${formatRelativeStage(stageSince)}`
          : `Stage ${roadmapStageLabel(completedCount, steps.length, allDone)} · ${allDone ? 'Complete' : current.name}`
      }
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        {steps.map((_, i) => {
          const state = roadmapStepState(i, completedCount, steps.length)
          return (
            <span
              key={i}
              className={`h-1.5 w-3 ${
                animate ? 'opacity-0 animate-roadmap-segment' : ''
              } ${
                state === 'done' ? 'bg-ember/60' : state === 'current' ? 'bg-ember' : 'bg-border'
              }`}
              style={animate ? { animationDelay: `${animateBaseDelayMs + i * 70}ms` } : undefined}
            />
          )
        })}
      </span>
      {showCaption && (
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground tabular-nums">
          {roadmapStageLabel(completedCount, steps.length, allDone)}
        </span>
      )}
    </span>
  )
}

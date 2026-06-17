'use client'

// Compact at-a-glance stage indicator.
// variant="chip"  — small inline tag (project header, project list)
// variant="bar"   — chip + step pips + "since" caption (quick panels)

import { formatRelativeStage, roadmapStuckDotClass, stageStuckLevel } from '@/lib/roadmap'

export type StageId =
  | 'idea'
  | 'demo'
  | 'arrangement'
  | 'recording'
  | 'mixing'
  | 'mastering'
  | 'released'

export type Stage = {
  id: StageId
  name: string
  short: string
  blurb: string
}

export const STAGES: Stage[] = [
  { id: 'idea',        name: 'Idea',        short: 'IDEA', blurb: 'Spark — voice memo, riff, lyric scrap.' },
  { id: 'demo',        name: 'Demo',        short: 'DEMO', blurb: 'Rough sketch, structure forming.' },
  { id: 'arrangement', name: 'Arrangement', short: 'ARR.',  blurb: 'Sections, chords and parts locked.' },
  { id: 'recording',   name: 'Recording',   short: 'REC',   blurb: 'Tracking real performances.' },
  { id: 'mixing',      name: 'Mixing',      short: 'MIX',   blurb: 'Balance, FX, automation.' },
  { id: 'mastering',   name: 'Mastering',   short: 'MAST',  blurb: 'Final polish for release.' },
  { id: 'released',    name: 'Released',    short: 'REL.',  blurb: 'Out in the world.' },
]

export function stageIndex(id: StageId) {
  const i = STAGES.findIndex(s => s.id === id)
  return i === -1 ? 0 : i
}

export function StagePill({
  stage,
  stageSince,
  variant = 'chip',
  className = '',
}: {
  stage: StageId
  stageSince: string
  variant?: 'chip' | 'bar'
  className?: string
}) {
  const idx = stageIndex(stage)
  const meta = STAGES[idx]
  const stuck = stageStuckLevel(stageSince)
  const dot = roadmapStuckDotClass(stuck)

  if (variant === 'chip') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 border border-ember/50 bg-ember-soft text-ember px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${className}`}
        title={`Stage ${idx + 1}/${STAGES.length} · ${meta.name} · since ${formatRelativeStage(stageSince)}`}
      >
        <span className={`size-1.5 rounded-full ${dot}`} />
        {meta.short}
        <span className="text-muted-foreground font-mono normal-case tracking-normal">
          {idx + 1}/{STAGES.length}
        </span>
      </span>
    )
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <StagePill stage={stage} stageSince={stageSince} variant="chip" />
      <div className="flex gap-0.5">
        {STAGES.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-3 ${
              i < idx ? 'bg-ember/60' : i === idx ? 'bg-ember' : 'bg-border'
            }`}
          />
        ))}
      </div>
      <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
        {formatRelativeStage(stageSince)}
      </span>
    </div>
  )
}

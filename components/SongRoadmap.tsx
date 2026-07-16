'use client'

import { Fragment, useEffect, useState } from 'react'
import { SectionLabel } from '@/components/design/AppShell'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import {
  formatRelativeStage,
  roadmapProgress,
  roadmapStageLabel,
  roadmapStepState,
  roadmapStuckCopy,
  roadmapStuckDotClass,
  roadmapStuckTextClass,
  stageStuckLevel,
  type ProjectRoadmap,
  type RoadmapStep,
} from '@/lib/roadmap'
import { trackEvent } from '@/lib/analytics'
import { fetchProjectRoadmapJson } from '@/lib/projectDataCache'

function roadmapStepMetrics(count: number) {
  if (count <= 5) return { col: '4.5rem', box: 'size-7', labelClass: 'text-[9px]' }
  if (count <= 8) return { col: '3.75rem', box: 'size-6', labelClass: 'text-[8px]' }
  if (count <= 12) return { col: '3rem', box: 'size-5', labelClass: 'text-[8px]' }
  return { col: '2.5rem', box: 'size-5', labelClass: 'text-[7px]' }
}

function RoadmapConnector({ filled }: { filled: boolean }) {
  return (
    <div className="w-full h-px bg-border" aria-hidden>
      <div
        className={`h-full bg-lime transition-all duration-300 ${filled ? 'w-full' : 'w-0'}`}
      />
    </div>
  )
}

function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 7l3.5 3.5L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M9 2L5 7l4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconChevronRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 2l4 5-4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconTrash({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1.5 3h9M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M10 3l-.75 7.5a.5.5 0 0 1-.5.5h-5.5a.5.5 0 0 1-.5-.5L2 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

function RoadmapSetup({
  initialSteps,
  onSave,
  readOnly,
}: {
  initialSteps?: string[]
  onSave: (names: string[]) => Promise<void>
  readOnly?: boolean
}) {
  const [draft, setDraft] = useState<string[]>(initialSteps?.length ? initialSteps : [''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function updateStep(i: number, value: string) {
    setDraft(prev => prev.map((s, idx) => (idx === i ? value : s)))
  }

  function addStep() {
    if (draft.length >= 20) return
    setDraft(prev => [...prev, ''])
  }

  function removeStep(i: number) {
    setDraft(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    const names = draft.map(s => s.trim()).filter(Boolean)
    if (!names.length) {
      setError('Add at least one step')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(names)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save roadmap')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border border-border bg-surface/50">
      <header className="px-4 py-2.5 border-b border-border">
        <SectionLabel>ROADMAP</SectionLabel>
        <p className="text-[10px] text-muted-foreground normal-case tracking-normal mt-1 m-0">
          Define your own production stages for this song.
        </p>
      </header>
      <div className="px-4 py-4 space-y-2">
        {draft.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">{i + 1}</span>
            <input
              value={step}
              onChange={e => updateStep(i, e.target.value)}
              disabled={readOnly || saving}
              placeholder={`Step ${i + 1}`}
              maxLength={50}
              className="flex-1 bg-background border border-border px-2.5 py-1.5 text-sm outline-none focus:border-lime disabled:opacity-50"
            />
            {!readOnly && draft.length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(i)}
                disabled={saving}
                className="size-7 border border-border grid place-items-center text-muted-foreground hover:border-destructive hover:text-destructive transition"
                aria-label={`Remove step ${i + 1}`}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
        {!readOnly && draft.length < 20 && (
          <button
            type="button"
            onClick={addStep}
            disabled={saving}
            className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime inline-flex items-center gap-1.5 transition"
          >
            <IconPlus /> Add step
          </button>
        )}
        {error && <p className="text-destructive text-xs m-0">{error}</p>}
      </div>
      {!readOnly && (
        <footer className="border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-7 px-3 border border-lime bg-lime text-primary-foreground text-[10px] font-bold uppercase tracking-widest transition disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save roadmap'}
          </button>
        </footer>
      )}
    </section>
  )
}

function RoadmapEditorButton({
  onClick,
  readOnly,
}: {
  onClick: () => void
  readOnly?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={readOnly}
      className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime transition disabled:opacity-50"
    >
      Edit steps
    </button>
  )
}

export function SongRoadmap({
  projectId,
  roadmap,
  onRoadmapChange,
  readOnly = false,
}: {
  projectId: string
  roadmap: ProjectRoadmap
  onRoadmapChange?: (roadmap: ProjectRoadmap) => void
  readOnly?: boolean
}) {
  const { steps, stepIndex, stageSince, configured } = roadmap
  const { completedCount, allDone, currentIndex } = roadmapProgress(stepIndex, steps.length)
  const current = steps[currentIndex]
  const [editingSteps, setEditingSteps] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!stageSince) return
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [stageSince])

  const stuck = stageSince ? stageStuckLevel(stageSince) : null
  const sinceLabel = stageSince ? formatRelativeStage(stageSince) : null

  async function saveSteps(names: string[]) {
    if (!onRoadmapChange) return
    const res = await fetch(`/api/projects/${projectId}/roadmap`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: names.map(name => ({ name })) }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Failed to save roadmap')
    }
    const data = await res.json() as ProjectRoadmap
    onRoadmapChange(data)
  }

  function jump(delta: number) {
    if (readOnly || !onRoadmapChange || !configured) return
    const next = Math.min(steps.length, Math.max(0, completedCount + delta))
    void moveTo(next)
  }

  function jumpTo(i: number) {
    if (readOnly || !onRoadmapChange || !configured) return
    void moveTo(Math.min(i, steps.length))
  }

  async function moveTo(nextIndex: number) {
    if (!onRoadmapChange) return

    const optimistic: ProjectRoadmap = {
      ...roadmap,
      stepIndex: nextIndex,
      stageSince: new Date().toISOString(),
    }
    onRoadmapChange(optimistic)

    try {
      const res = await fetch(`/api/projects/${projectId}/roadmap`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIndex: nextIndex }),
      })
      if (res.ok) {
        const data = await res.json() as ProjectRoadmap
        onRoadmapChange(data)
        trackEvent('roadmap_step_changed', { step: nextIndex })
      }
    } catch { /* keep optimistic */ }
  }

  if (!configured || editingSteps) {
    return (
      <RoadmapSetup
        initialSteps={configured ? steps.map(s => s.name) : undefined}
        readOnly={readOnly}
        onSave={async names => {
          await saveSteps(names)
          setEditingSteps(false)
        }}
      />
    )
  }

  const stepMetrics = roadmapStepMetrics(steps.length)

  return (
    <section className="border border-border bg-surface/50 overflow-visible">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <SectionLabel>ROADMAP</SectionLabel>
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground whitespace-nowrap">
            STAGE {roadmapStageLabel(completedCount, steps.length, allDone)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RoadmapEditorButton onClick={() => setEditingSteps(true)} readOnly={readOnly} />
          {!readOnly && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => jump(-1)}
                disabled={completedCount <= 0}
                className="size-7 border border-border grid place-items-center hover:border-lime hover:text-lime transition disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move back one stage"
              >
                <IconChevronLeft size={13} />
              </button>
              <button
                onClick={() => jump(1)}
                disabled={completedCount >= steps.length}
                className="h-7 px-2.5 border border-lime bg-lime text-primary-foreground text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1 transition disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Advance to next stage"
              >
                Advance <IconChevronRight size={11} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="py-4 px-4 overflow-visible">
        <div className="flex items-start w-full">
          {steps.map((s, i) => {
            const state = roadmapStepState(i, completedCount, steps.length)
            return (
              <Fragment key={s.id}>
                {i > 0 && (
                  <div className="flex-1 min-w-[4px] mt-3.5 self-start">
                    <RoadmapConnector filled={i <= completedCount} />
                  </div>
                )}
                <div
                  className="shrink-0 flex flex-col items-center"
                  style={{ width: stepMetrics.col }}
                >
                  <HoverTooltip label={s.name} className="shrink-0 flex">
                    <button
                      type="button"
                      onClick={() => jumpTo(i)}
                      disabled={readOnly}
                      aria-current={state === 'current' ? 'step' : undefined}
                      aria-label={readOnly ? s.name : `Move to ${s.name}`}
                      className={`relative z-10 ${stepMetrics.box} grid place-items-center border text-[10px] font-bold transition ${
                        state === 'done'
                          ? 'bg-lime border-lime text-primary-foreground'
                          : state === 'current'
                          ? 'bg-background border-lime text-lime ring-2 ring-lime/30'
                          : readOnly
                          ? 'bg-background border-border text-muted-foreground cursor-default'
                          : 'bg-background border-border text-muted-foreground hover:border-lime hover:text-lime'
                      }`}
                    >
                      {state === 'done' ? <IconCheck size={12} /> : i + 1}
                    </button>
                  </HoverTooltip>
                  <span
                    className={`mt-2 w-full px-0.5 font-bold uppercase tracking-wide text-center leading-tight line-clamp-3 break-words ${stepMetrics.labelClass} ${
                      state === 'ahead' ? 'text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {s.name.trim().toUpperCase()}
                  </span>
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>

      <footer className="border-t border-border px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-widest">
        <span className="inline-flex items-center gap-1.5 font-bold text-foreground">
          <span
            className={`size-1.5 rounded-full shrink-0 ${stuck ? roadmapStuckDotClass(stuck) : 'bg-lime'}`}
            aria-hidden
          />
          {allDone ? 'Complete' : (current?.name ?? '—')}
        </span>
        {sinceLabel && stuck && (
          <span className={`ml-auto ${roadmapStuckTextClass(stuck)}`}>
            Since {sinceLabel} · {roadmapStuckCopy(stuck)}
          </span>
        )}
      </footer>
    </section>
  )
}

// Load roadmap from API (shared in-flight cache with the mixer page)
export async function fetchProjectRoadmap(projectId: string): Promise<ProjectRoadmap> {
  try {
    return await fetchProjectRoadmapJson<ProjectRoadmap>(projectId)
  } catch {
    return { steps: [], stepIndex: null, stageSince: null, configured: false }
  }
}

export function useProjectRoadmap(projectId: string | null) {
  const [roadmap, setRoadmap] = useState<ProjectRoadmap>({
    steps: [],
    stepIndex: null,
    stageSince: null,
    configured: false,
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setRoadmap({ steps: [], stepIndex: null, stageSince: null, configured: false })
      setLoaded(false)
      return
    }
    let cancelled = false
    setLoaded(false)
    fetchProjectRoadmap(projectId).then(data => {
      if (!cancelled) {
        setRoadmap(data)
        setLoaded(true)
      }
    })
    return () => { cancelled = true }
  }, [projectId])

  return { roadmap, setRoadmap, loaded }
}

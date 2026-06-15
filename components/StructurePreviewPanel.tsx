'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { getBarMath, sectionLabel } from '@/components/StructureEditor'
import { BrandSpinner } from '@/components/BrandSpinner'
import { ResourcesCard } from '@/components/ResourcesCard'
import { SectionLabel } from '@/components/design/AppShell'
import type { Project, Section } from '@/lib/types'

type PanelTab = 'resources' | 'structure' | 'notes'

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconFileDescription({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 13h6M9 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconLayoutList({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms) return '0:00'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatChords(raw: string | null | undefined): string {
  if (!raw?.trim()) return '—'
  return raw.trim().split(/\s+/).filter(Boolean).join(' - ')
}

interface PreviewProject {
  id: string
  name: string
  bpm: number | null
  key: string | null
  time_signature: string
  track_count: number
  total_duration_ms: number
}

interface PreviewVersion {
  id: string
  name: string
  type: 'main' | 'branch'
}

interface StructurePreviewData {
  project: PreviewProject
  versions: PreviewVersion[]
  sections: Section[]
}

const TABS: PanelTab[] = ['resources', 'structure', 'notes']

// ─── Panel ────────────────────────────────────────────────────────────────────

export function StructurePreviewPanel({
  projectId,
  bandId,
  onClose,
}: {
  projectId: string | null
  accentColor: string
  bandId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<StructurePreviewData | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [contentVisible, setContentVisible] = useState(true)
  const [versionLoading, setVersionLoading] = useState(false)
  const prevProjectIdRef = useRef<string | null>(null)

  const [activeTab, setActiveTab] = useState<PanelTab>('resources')

  const [notesContent, setNotesContent] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [resourcesMounted, setResourcesMounted] = useState(true)

  const handleClose = useCallback(() => {
    setPanelOpen(false)
    setTimeout(onClose, 200)
  }, [onClose])

  useEffect(() => {
    if (projectId) {
      setMounted(true)
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelOpen(true))
      })
    } else {
      setPanelOpen(false)
      const t = setTimeout(() => {
        setMounted(false)
        document.body.style.overflow = ''
      }, 250)
      return () => clearTimeout(t)
    }
    return () => { document.body.style.overflow = '' }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, handleClose])

  const loadPreview = useCallback(async (id: string, swap = false) => {
    if (swap) {
      setContentVisible(false)
      await new Promise(r => setTimeout(r, 100))
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${id}/structure-preview`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load')
      const json = await res.json() as StructurePreviewData
      setData(json)
      setSections(json.sections ?? [])
      const main = json.versions.find(v => v.type === 'main')
      setSelectedVersionId(main?.id ?? json.versions[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setData(null)
      setSections([])
    } finally {
      setLoading(false)
      if (swap) {
        requestAnimationFrame(() => setContentVisible(true))
      } else {
        setContentVisible(true)
      }
    }
  }, [])

  useEffect(() => {
    if (!projectId) {
      prevProjectIdRef.current = null
      return
    }
    setActiveTab('resources')
    setResourcesMounted(true)
    const isSwap = prevProjectIdRef.current !== null && prevProjectIdRef.current !== projectId
    if (isSwap) {
      setNotesContent('')
      setNotesLoaded(false)
    }
    prevProjectIdRef.current = projectId
    loadPreview(projectId, isSwap)
  }, [projectId, loadPreview])

  async function loadNotes(id: string) {
    if (notesLoaded) return
    try {
      const res = await fetch(`/api/projects/${id}/notes`)
      if (res.ok) {
        const { content } = await res.json()
        setNotesContent(content ?? '')
        setNotesLoaded(true)
      }
    } catch {
      setNotesLoaded(true)
    }
  }

  function handleTabChange(tab: PanelTab) {
    setActiveTab(tab)
    if (tab === 'notes' && projectId && !notesLoaded) loadNotes(projectId)
    if (tab === 'resources') setResourcesMounted(true)
  }

  function handleNotesChange(value: string) {
    setNotesContent(value)
    if (!projectId) return
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      setNotesSaving(true)
      try {
        await fetch(`/api/projects/${projectId}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: value }),
        })
      } finally {
        setNotesSaving(false)
      }
    }, 800)
  }

  async function handleVersionChange(versionId: string) {
    if (versionId === selectedVersionId) return
    setSelectedVersionId(versionId)
    setVersionLoading(true)
    try {
      const res = await fetch(`/api/versions/${versionId}/sections`)
      if (!res.ok) throw new Error('Failed to load sections')
      const { sections: next } = await res.json()
      setSections(next ?? [])
    } catch {
      /* keep previous sections */
    } finally {
      setVersionLoading(false)
    }
  }

  if (!mounted) return null

  const project = data?.project
  const versions = data?.versions ?? []
  const selectedVersion = versions.find(v => v.id === selectedVersionId)
  const projectForMath: Project | null = project
    ? {
        id: project.id,
        band_id: bandId,
        name: project.name,
        bpm: project.bpm,
        key: project.key,
        time_signature: project.time_signature,
      }
    : null

  const { barDurationMs } = projectForMath
    ? getBarMath(projectForMath, project!.total_duration_ms)
    : { barDurationMs: 4000 }

  const totalSectionBars = sections.reduce(
    (sum, s) => sum + Math.max(0, s.end_bar - s.start_bar),
    0
  )

  const viewingLabel = (selectedVersion?.name ?? 'main').toUpperCase()

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex justify-end"
      onClick={handleClose}
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity duration-250 ${
          panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer — slides in from right; full width on mobile, max-w-xl on larger screens */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={project ? `${project.name} quick access` : 'Quick access'}
        onClick={e => e.stopPropagation()}
        className={`relative flex h-full w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl transition-transform duration-250 ease-out ${
          panelOpen ? 'translate-x-0 animate-slide-in' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 pr-3">
            <SectionLabel>QUICK ACCESS</SectionLabel>
            <div className="font-display mt-0.5 truncate text-lg uppercase tracking-tight text-foreground">
              {project?.name ?? 'Loading…'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="shrink-0 border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-border">
          {TABS.map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              className={`h-10 flex-1 px-2 text-[10px] uppercase tracking-widest border-b-2 transition sm:px-4 ${
                activeTab === tab
                  ? 'border-ember text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div
          className="flex-1 overflow-y-auto p-4 sm:p-5"
          style={{
            opacity: contentVisible ? 1 : 0,
            transition: contentVisible ? 'opacity 0.15s ease-out' : 'opacity 0.1s ease-in',
          }}
        >
          {/* Resources */}
          {activeTab === 'resources' && resourcesMounted && project && (
            <ResourcesCard
              projectId={project.id}
              projectName={project.name}
              bare
              variant="drawer"
            />
          )}

          {/* Structure */}
          {activeTab === 'structure' && (
            loading ? (
              <BrandSpinner fullscreen={false} />
            ) : error ? (
              <p className="text-destructive text-sm m-0">{error}</p>
            ) : sections.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[240px] gap-2 text-muted-foreground text-center">
                <IconLayoutList />
                <p className="text-sm text-muted-foreground m-0">No structure defined yet</p>
                <p className="text-xs text-muted-foreground/70 m-0">Open the project to add song structure</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionLabel>VIEWING · {viewingLabel}</SectionLabel>
                  {versions.length > 0 && (
                    <select
                      value={selectedVersionId ?? ''}
                      onChange={e => handleVersionChange(e.target.value)}
                      disabled={versionLoading}
                      className="bg-surface border border-border text-[10px] uppercase tracking-widest px-2 py-1 outline-none focus:border-ember max-w-[160px] truncate cursor-pointer disabled:opacity-50"
                    >
                      {versions.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name}{v.type === 'main' ? ' (main)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                  {sections.length} SECTION{sections.length !== 1 ? 'S' : ''} · {totalSectionBars} BAR{totalSectionBars !== 1 ? 'S' : ''}
                </div>

                <div className="border border-border divide-y divide-border">
                  {sections.map(section => {
                    const startBar = section.start_bar + 1
                    const endBar = section.end_bar
                    const startTime = formatDuration(section.start_bar * barDurationMs)

                    return (
                      <div
                        key={section.id}
                        className="grid grid-cols-1 sm:grid-cols-[minmax(72px,88px)_1fr_auto] gap-1 sm:gap-3 items-start sm:items-center px-3 py-2.5 text-xs"
                      >
                        <span className="text-ember font-bold tracking-widest uppercase shrink-0">
                          {sectionLabel(section).toUpperCase()}
                        </span>
                        <span className="text-muted-foreground font-mono truncate">
                          {formatChords(section.chords)}
                        </span>
                        <span className="text-muted-foreground tabular-nums font-mono whitespace-nowrap sm:text-right">
                          {startBar}–{endBar} · {startTime}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          )}

          {/* Notes */}
          {activeTab === 'notes' && (
            <div className="flex flex-col h-full min-h-[280px]">
              <textarea
                value={notesContent}
                onChange={e => handleNotesChange(e.target.value)}
                placeholder="Project notes, ideas, references…"
                className="w-full flex-1 min-h-[240px] bg-surface border border-border p-3 text-sm text-foreground outline-none focus:border-ember resize-none leading-relaxed placeholder:text-muted-foreground/60"
              />
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground text-right mt-2 m-0">
                {notesSaving ? 'Saving…' : notesContent ? 'Auto-saved' : ''}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {projectId && (
          <div className="shrink-0 border-t border-border p-4 flex justify-end">
            <button
              type="button"
              onClick={() => router.push(`/band/${bandId}/project/${projectId}`)}
              className="bg-ember text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition"
            >
              Open Full Mixer ↗
            </button>
          </div>
        )}
      </aside>
    </div>,
    document.body
  )
}

export { IconFileDescription }

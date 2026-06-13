'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { SECTION_COLORS, getBarMath, sectionLabel } from '@/components/StructureEditor'
import { BrandSpinner } from '@/components/BrandSpinner'
import { ResourcesCard } from '@/components/ResourcesCard'
import type { Project, Section } from '@/lib/types'

type PanelTab = 'structure' | 'notes' | 'resources'

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

function IconArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconX({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

function barTimeRange(
  startBar: number,
  endBar: number,
  barDurationMs: number
): string {
  const startMs = startBar * barDurationMs
  const endMs = endBar * barDurationMs
  return `${formatDuration(startMs)}—${formatDuration(endMs)}`
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

// ─── Panel ────────────────────────────────────────────────────────────────────

export function StructurePreviewPanel({
  projectId,
  accentColor,
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
  const [isMobile, setIsMobile] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<StructurePreviewData | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const [versionLoading, setVersionLoading] = useState(false)
  const versionMenuRef = useRef<HTMLDivElement>(null)
  const prevProjectIdRef = useRef<string | null>(null)

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<PanelTab>('resources')

  // Notes tab
  const [notesContent, setNotesContent] = useState('')
  const [notesLoaded, setNotesLoaded] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resources tab — ResourcesCard handles its own fetching.
  // We mount it once the tab is visited so it doesn't unmount/remount on tab switches.
  const [resourcesTabVisited, setResourcesTabVisited] = useState(true)
  const [resourcesMounted, setResourcesMounted] = useState(true)

  const handleClose = useCallback(() => {
    setPanelOpen(false)
    setTimeout(onClose, 200)
  }, [onClose])

  // Mount / unmount with animation
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

  // Mobile breakpoint
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 519px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Escape to close
  useEffect(() => {
    if (!projectId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, handleClose])

  // Close version menu on outside click
  useEffect(() => {
    if (!versionMenuOpen) return
    function onDown(e: MouseEvent) {
      if (versionMenuRef.current && !versionMenuRef.current.contains(e.target as Node)) {
        setVersionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [versionMenuOpen])

  const loadPreview = useCallback(async (id: string, swap = false) => {
    if (swap) {
      setContentVisible(false)
      await new Promise(r => setTimeout(r, 100))
    }
    setLoading(true)
    setError('')
    setVersionMenuOpen(false)
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
    setResourcesTabVisited(true)
    setResourcesMounted(true)
    const isSwap = prevProjectIdRef.current !== null && prevProjectIdRef.current !== projectId
    if (isSwap) {
      setNotesContent('')
      setNotesLoaded(false)
    }
    prevProjectIdRef.current = projectId
    loadPreview(projectId, isSwap)
  }, [projectId, loadPreview])

  // Load notes when notes tab is first selected
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
      setNotesLoaded(true) // fail silently — start with empty
    }
  }

  function handleTabChange(tab: PanelTab) {
    setActiveTab(tab)
    if (tab === 'notes' && projectId && !notesLoaded) loadNotes(projectId)
    if (tab === 'resources') { setResourcesTabVisited(true); setResourcesMounted(true) }
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
    setVersionMenuOpen(false)
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

  const subtitleParts: string[] = []
  if (project) {
    subtitleParts.push(`${project.track_count} track${project.track_count !== 1 ? 's' : ''}`)
    if (project.total_duration_ms > 0) {
      subtitleParts.push(formatDuration(project.total_duration_ms))
    }
    if (project.bpm) subtitleParts.push(`${project.bpm} BPM`)
    if (project.key) subtitleParts.push(project.key)
  }

  return createPortal(
    <>
      <div
        className={`structure-preview-backdrop${panelOpen ? ' is-open' : ''}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      <aside
        className={`structure-preview-panel${panelOpen ? ' is-open' : ''}${isMobile ? ' is-mobile' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={project ? `${project.name} structure preview` : 'Structure preview'}
      >
        {isMobile && <div className="structure-preview-handle" aria-hidden="true" />}

        {/* Header */}
        <div className="structure-preview-header">
          <div className="structure-preview-header-left">
            <div className="structure-preview-title-row">
              <span className="structure-preview-accent-dot" style={{ background: accentColor }} />
              <span className="structure-preview-title">{project?.name ?? 'Loading…'}</span>
            </div>
            {subtitleParts.length > 0 && (
              <p className="structure-preview-subtitle">{subtitleParts.join(' · ')}</p>
            )}
          </div>
          <div className="structure-preview-header-actions">
            {projectId && (
              <button
                type="button"
                className="structure-preview-open-btn"
                onClick={() => router.push(`/band/${bandId}/project/${projectId}`)}
              >
                <IconArrowRight size={13} />
                Open
              </button>
            )}
            <button
              type="button"
              className="structure-preview-close-btn"
              onClick={handleClose}
              aria-label="Close"
            >
              <IconX />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            padding: '0 16px',
            borderBottom: '0.5px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {(['resources', 'structure', 'notes'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabChange(tab)}
              style={{
                fontSize: 12,
                fontWeight: activeTab === tab ? 500 : 400,
                color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '9px 10px 7px',
                cursor: 'pointer',
                textTransform: 'capitalize',
                transition: 'color 0.12s',
                marginBottom: -0.5,
              }}
              onMouseEnter={e => {
                if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
              }}
              onMouseLeave={e => {
                if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          className="structure-preview-content"
          style={{
            opacity: contentVisible ? 1 : 0,
            transition: contentVisible ? 'opacity 0.15s ease-out' : 'opacity 0.1s ease-in',
          }}
        >
          {/* ── Structure tab ── */}
          {activeTab === 'structure' && (
            loading ? (
              <BrandSpinner fullscreen={false} />
            ) : error ? (
              <p className="structure-preview-status structure-preview-status-error">{error}</p>
            ) : sections.length === 0 ? (
              <div className="structure-preview-empty">
                <IconLayoutList />
                <p className="structure-preview-empty-title">No structure defined yet</p>
                <p className="structure-preview-empty-hint">Open the project to add song structure</p>
              </div>
            ) : (
              <>
                {versions.length > 1 && selectedVersion && (
                  <div className="structure-preview-version-row" ref={versionMenuRef}>
                    <button
                      type="button"
                      className="structure-preview-version-pill"
                      onClick={() => setVersionMenuOpen(v => !v)}
                      disabled={versionLoading}
                    >
                      Viewing: {selectedVersion.name}
                      <IconChevronDown />
                    </button>
                    {versionMenuOpen && (
                      <div className="structure-preview-version-menu">
                        {versions.map(v => (
                          <button
                            key={v.id}
                            type="button"
                            className="structure-preview-version-option"
                            data-active={v.id === selectedVersionId ? 'true' : 'false'}
                            onClick={() => handleVersionChange(v.id)}
                          >
                            {v.name}
                            {v.type === 'main' && (
                              <span className="structure-preview-version-tag">main</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p className="structure-preview-summary">
                  {sections.length} section{sections.length !== 1 ? 's' : ''}
                  {' · '}
                  {totalSectionBars} bar{totalSectionBars !== 1 ? 's' : ''}
                </p>

                <div className="structure-preview-sections">
                  {sections.map(section => {
                    const colors = SECTION_COLORS[section.type]
                    const chords = section.chords?.trim()
                      ? section.chords.trim().split(/\s+/).filter(Boolean)
                      : []

                    return (
                      <div
                        key={section.id}
                        className="structure-preview-section-card"
                        style={{ borderLeftColor: section.color || colors.fg }}
                      >
                        <div className="structure-preview-section-top">
                          <span
                            className="structure-preview-section-type"
                            style={{ background: colors.bg, color: colors.fg }}
                          >
                            {sectionLabel(section)}
                          </span>
                          <span className="structure-preview-section-range">
                            Bars {section.start_bar + 1}—{section.end_bar}
                            {' · '}
                            {barTimeRange(section.start_bar, section.end_bar, barDurationMs)}
                          </span>
                        </div>

                        {chords.length > 0 && (
                          <div className="structure-preview-chords">
                            <p className="structure-preview-chords-label">Chords</p>
                            <div className="structure-preview-chord-pills">
                              {chords.map((chord, i) => (
                                <span key={`${section.id}-${i}`} className="structure-preview-chord-pill">
                                  {chord}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )
          )}

          {/* ── Notes tab ── */}
          {activeTab === 'notes' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <textarea
                value={notesContent}
                onChange={e => handleNotesChange(e.target.value)}
                placeholder="Project notes, ideas, references…"
                style={{
                  flex: 1,
                  width: '100%',
                  resize: 'none',
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--text-sec)',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  padding: 0,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  minHeight: 240,
                }}
              />
              <p style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', marginTop: 6, flexShrink: 0 }}>
                {notesSaving ? 'Saving…' : notesContent ? 'Auto-saved' : ''}
              </p>
            </div>
          )}

          {/* ── Resources tab ── */}
          {/* Keep mounted once visited so switching away and back doesn't refetch */}
          {resourcesMounted && project && (
            <div style={{ display: activeTab === 'resources' ? 'block' : 'none' }}>
              <ResourcesCard
                projectId={project.id}
                projectName={project.name}
                bare={true}
              />
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body
  )
}

export { IconFileDescription }

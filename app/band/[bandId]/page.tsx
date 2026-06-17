'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { BandWelcomeModal } from '@/components/onboarding/BandWelcomeModal'
import { StructurePreviewPanel } from '@/components/StructurePreviewPanel'
import { BrandSpinner } from '@/components/BrandSpinner'
import { activityCategoryLabel, activityColorClass, activityDescriptionParts, activityDotClass } from '@/lib/activityFormat'
import { avatarColor, avatarInitials } from '@/lib/avatarTheme'
import { usePalette } from '@/contexts/PaletteContext'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { AppHeader, SectionLabel, StatusFooter } from '@/components/design/AppShell'
import { TbButton, TbMenuButton } from '@/components/design/TbButton'
import { TbInput } from '@/components/design/TbInput'
import { TbModal } from '@/components/design/TbModal'
import { ResourceErrorScreen } from '@/components/design/ResourceErrorScreen'
import { RoadmapPreview } from '@/components/RoadmapPreview'
import type { ProjectRoadmap } from '@/lib/roadmap'
import { registerPlaybackStop } from '@/lib/playbackSession'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Band { id: string; name: string; created_at: string }

interface EnhancedProject {
  id: string; name: string; bpm: number | null; key: string | null; created_at: string
  track_count: number; total_duration_ms: number; version_count: number
  comment_count: number; last_updated_at: string; first_track_id: string | null
  roadmap_configured: boolean
  roadmap_steps: { name: string }[]
  roadmap_step_index: number | null
  stage_since: string | null
  checklist_my_total: number; checklist_my_done: number
  checklist_card_tasks: { id: string; text: string; assignee_id: string | null }[]
}

interface BandMember {
  user_id: string; role: string; role_label: string | null; role_color: string | null
  joined_at: string
  profiles: { id: string; username: string; display_name: string | null; avatar_color: string | null } | null
}

interface ActivityItem {
  id: string; action: string; subject: string; detail: string | null
  created_at: string; username: string; project_id: string | null
  project_name: string | null
}

interface BandStats {
  branches: number; merges: number; comments: number
  storage_bytes: number; tracks: number
}

interface JoinRequest {
  id: string
  user_id: string
  created_at: string
  profile: { username: string; display_name: string | null; avatar_color: string | null } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!ms) return '0:00'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = diff / 60000
  const hours = diff / 3600000
  const days = diff / 86400000
  if (mins < 2) return 'just now'
  if (mins < 60) return `${Math.floor(mins)}m ago`
  if (hours < 24) return `${Math.floor(hours)}h ago`
  if (days < 2) return 'yesterday'
  return `${Math.floor(days)}d ago`
}

function formatLastEdited(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const days = diff / 86400000
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 7) return `${Math.floor(days)}d ago`
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function formatGroupDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const item = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (item === today) return 'Today'
  if (item === today - 86400000) return 'Yesterday'
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}

function formatFoundedHero(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' }).toUpperCase()
}

function IconPlay({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor">
      <path d="M3.5 2l8 5-8 5V2z" />
    </svg>
  )
}

function IconPause({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor">
      <rect x="2" y="2" width="3.5" height="10" rx="1" />
      <rect x="8.5" y="2" width="3.5" height="10" rx="1" />
    </svg>
  )
}

function IconCopy({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <rect x="4" y="1" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="0.9"/>
      <path d="M1 4v7a1 1 0 0 0 1 1h7" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
    </svg>
  )
}

function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconPlus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconSpinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ animation: 'spin 0.7s linear infinite' }}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
      <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </svg>
  )
}

function IconPlayError({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ color: '#f87171' }}>
      <circle cx="7" cy="7" r="5.5" stroke="#f87171" strokeWidth="1.5" />
      <path d="M7 4.5v3" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="9.5" r="0.75" fill="#f87171" />
    </svg>
  )
}

function IconDotsV({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="3" r="1" fill="currentColor"/>
      <circle cx="7" cy="7" r="1" fill="currentColor"/>
      <circle cx="7" cy="11" r="1" fill="currentColor"/>
    </svg>
  )
}

// ─── New project modal ─────────────────────────────────────────────────────────

function NewProjectModal({ bandId, onClose, onCreated }: {
  bandId: string; onClose: () => void; onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/bands/${bandId}/projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), bpm: bpm ? parseInt(bpm) : undefined, key: key || undefined }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { project } = await res.json()
      onCreated(project.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setLoading(false) }
  }

  return (
    <TbModal onClose={onClose}>
      <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">New project</p>
      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Project name</label>
          <TbInput value={name} onChange={e => setName(e.target.value)} placeholder="Summer EP, Track 3…" autoFocus required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">BPM</label>
            <TbInput value={bpm} onChange={e => setBpm(e.target.value)} placeholder="120" type="number" min="40" max="300" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Key</label>
            <TbInput value={key} onChange={e => setKey(e.target.value)} placeholder="C minor" />
          </div>
        </div>
        {error && <p className="text-destructive text-xs m-0">{error}</p>}
        <div className="flex gap-2 justify-end mt-1">
          <TbButton onClick={onClose}>Cancel</TbButton>
          <TbButton variant="primary" type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Creating…' : 'Create project'}
          </TbButton>
        </div>
      </form>
    </TbModal>
  )
}

// ─── Rename project modal ──────────────────────────────────────────────────────

function RenameProjectModal({ projectId, initialName, onClose, onRenamed }: {
  projectId: string
  initialName: string
  onClose: () => void
  onRenamed: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRename(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialName) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { project } = await res.json()
      onRenamed(project.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <TbModal onClose={onClose}>
      <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">Rename project</p>
      <form onSubmit={handleRename} className="flex flex-col gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Project name</label>
          <TbInput value={name} onChange={e => setName(e.target.value)} placeholder="Project name" autoFocus required />
        </div>
        {error && <p className="text-destructive text-xs m-0">{error}</p>}
        <div className="flex gap-2 justify-end mt-1">
          <TbButton type="button" onClick={onClose}>Cancel</TbButton>
          <TbButton variant="primary" type="submit" disabled={loading || !name.trim()}>
            {loading ? 'Saving…' : 'Save'}
          </TbButton>
        </div>
      </form>
    </TbModal>
  )
}

// ─── Project row ──────────────────────────────────────────────────────────────

const ProjectRow = memo(function ProjectRow({
  project, index, playing, loading, error, onPlay, onOpen, onQuick, onRename, onDelete, onMetaUpdated, isOwner,
}: {
  project: EnhancedProject
  index: number
  playing: boolean
  loading: boolean
  error: boolean
  onPlay: (e: React.MouseEvent, projectId: string) => void
  onOpen: (projectId: string) => void
  onQuick: (e: React.MouseEvent, projectId: string) => void
  onRename: (projectId: string, name: string) => void
  onDelete?: (projectId: string, name: string) => void
  onMetaUpdated: (projectId: string, patch: { bpm: number | null; key: string | null }) => void
  isOwner: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const playActive = playing || loading

  return (
    <div
      className={`bg-background flex flex-col gap-3 sm:grid sm:grid-cols-[auto_1fr_auto] sm:gap-4 sm:items-center px-4 py-4 hover:bg-surface transition-colors animate-slide-in relative overflow-visible ${
        menuOpen ? 'z-30' : 'z-0'
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-3 sm:contents min-w-0">
        <button
          type="button"
          onClick={e => onPlay(e, project.id)}
          disabled={loading && !playing}
          aria-label={playing ? `Pause ${project.name}` : `Play ${project.name}`}
          className={`size-10 shrink-0 border grid place-items-center transition group ${
            playActive
              ? 'bg-ember border-ember text-white'
              : 'border-border bg-surface-2 hover:bg-ember hover:border-ember hover:text-white'
          } ${!project.first_track_id ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {error
            ? <IconPlayError />
            : loading
              ? <IconSpinner />
              : playing
                ? <IconPause />
                : <IconPlay />}
        </button>

        <button
          type="button"
          onClick={() => onOpen(project.id)}
          className="min-w-0 flex-1 text-left sm:flex-none"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-display text-lg uppercase tracking-tight truncate hover:text-ember transition-colors">
              {project.name}
            </div>
            {project.roadmap_configured && project.roadmap_step_index != null && (
              <RoadmapPreview
                steps={project.roadmap_steps}
                stepIndex={project.roadmap_step_index}
                stageSince={project.stage_since}
                animate
                animateBaseDelayMs={index * 40 + 320}
              />
            )}
            {project.checklist_my_total > 0 && (
              <span
                className="inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-muted-foreground"
                title={project.checklist_card_tasks.map(t => t.text).join('\n')}
              >
                <span className="h-1 w-10 bg-surface-2 border border-border inline-block overflow-hidden">
                  <span
                    className="block h-full bg-ember"
                    style={{ width: `${Math.round((project.checklist_my_done / project.checklist_my_total) * 100)}%` }}
                  />
                </span>
                {project.checklist_my_done}/{project.checklist_my_total}
              </span>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{project.track_count} TRACKS</span>
            {project.total_duration_ms > 0 && <span>{formatDuration(project.total_duration_ms)}</span>}
            {project.bpm != null && <span className="text-ember">{project.bpm} BPM</span>}
            {project.key && <span>{project.key.toUpperCase()}</span>}
            <span>{project.version_count} BRANCH{project.version_count !== 1 ? 'ES' : ''}</span>
            <span>{project.comment_count} COMMENTS</span>
            <span className="text-muted-foreground/70">{formatLastEdited(project.last_updated_at).toUpperCase()}</span>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-1 shrink-0 sm:justify-end">
        <TbButton onClick={e => onQuick(e, project.id)}>Quick peek</TbButton>
        <TbButton variant="solid" onClick={() => onOpen(project.id)}>Open ↗</TbButton>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
            aria-label="Project options"
            className="size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition-colors"
          >
            <IconDotsV />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-52 border border-border bg-popover shadow-2xl flex flex-col overflow-hidden">
              <TbMenuButton onClick={() => { setMenuOpen(false); onOpen(project.id) }}>
                Open project
              </TbMenuButton>
              <TbMenuButton onClick={() => { setMenuOpen(false); onRename(project.id, project.name) }}>
                Rename
              </TbMenuButton>
              <div className="px-3 py-2 border-b border-border" onClick={e => e.stopPropagation()}>
                <ProjectMetaFields
                  projectId={project.id}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={patch => onMetaUpdated(project.id, patch)}
                  variant="menu"
                />
              </div>
              {isOwner && (
                <TbMenuButton
                  danger
                  onClick={() => { setMenuOpen(false); onDelete?.(project.id, project.name) }}
                >
                  Delete project
                </TbMenuButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ─── Page ─────────────────────────────────────────────────────────────────────
 
export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>()
  const router = useRouter()
  const { user, profile, loading: authLoading, updateOnboarding } = useAuth()
  const { palette } = usePalette()

  // ── Data state ──────────────────────────────────────────────────────────────
  const [band, setBand] = useState<Band | null>(null)
  const [projects, setProjects] = useState<EnhancedProject[]>([])
  const [members, setMembers] = useState<BandMember[]>([])
  const [myRole, setMyRole] = useState('')
  const [stats, setStats] = useState<BandStats>({ branches: 0, merges: 0, comments: 0, storage_bytes: 0, tracks: 0 })
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([])
  const [totalActivity, setTotalActivity] = useState(0)
  const [storageLimitBytes, setStorageLimitBytes] = useState(10 * 1024 * 1024 * 1024)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'access_denied' | 'unknown' | null>(null)

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'projects' | 'activity'>('projects')
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [playingProjectId, setPlayingProjectId] = useState<string | null>(null)
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null)
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playbackGenRef = useRef(0)
  const [showNewProject, setShowNewProject] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteCopying, setInviteCopying] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [regeneratingCode, setRegeneratingCode] = useState(false)
  const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequest[]>([])
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [editRoleLabel, setEditRoleLabel] = useState('')
  const [memberMenu, setMemberMenu] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null)
  const [renameModal, setRenameModal] = useState<{ id: string; name: string } | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [previewProject, setPreviewProject] = useState<EnhancedProject | null>(null)
  const previewProjectRef = useRef(previewProject)
  previewProjectRef.current = previewProject
  const [showWelcomeDismissed, setShowWelcomeDismissed] = useState(false)
  const [bandNameEditing, setBandNameEditing] = useState(false)
  const [bandNameValue, setBandNameValue] = useState('')
  const [bandNameFlash, setBandNameFlash] = useState(false)
  const bandNameInputRef = useRef<HTMLInputElement>(null)
  const projectsRef = useRef(projects)
  projectsRef.current = projects

  function stopPlayback() {
    const audio = audioRef.current
    if (audio) {
      audio.oncanplay = null
      audio.onplaying = null
      audio.onended = null
      audio.onerror = null
      audio.onstalled = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
    playbackGenRef.current += 1
  }

  // ── Cleanup audio on unmount / navigation ───────────────────────────────────
  useEffect(() => {
    const cleanup = () => {
      stopPlayback()
      setPlayingProjectId(null)
      setLoadingProjectId(null)
    }
    const unregister = registerPlaybackStop(cleanup)
    return () => {
      unregister()
      cleanup()
    }
  }, [])

  // ── Tab from URL ────────────────────────────────────────────────────────────
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('tab') === 'activity') {
      setActiveTab('activity')
      loadActivity()
    }
  }, []) // eslint-disable-line

  function switchTab(tab: 'projects' | 'activity') {
    setActiveTab(tab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    history.replaceState({}, '', url.toString())
    if (tab === 'activity') {
      if (activityItems.length === 0) loadActivity()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // ── Load data ────────────────────────────────────────────────────────────────
  async function loadBand() {
    const res = await fetch(`/api/bands/${bandId}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      if (res.status === 403 || body?.code === 'ACCESS_DENIED') setError('access_denied')
      else if (res.status === 404 || body?.code === 'NOT_FOUND') setError('not_found')
      else setError('unknown')
      setLoading(false)
      return
    }
    const data = await res.json()
    setBand(data.band)
    setProjects(data.projects ?? [])
    setMembers(data.members ?? [])
    setMyRole(data.myRole ?? '')
    setStats(data.stats ?? { branches: 0, merges: 0, comments: 0, storage_bytes: 0, tracks: 0 })
    setRecentActivity(data.recentActivity ?? [])
    setTotalActivity(data.totalActivity ?? 0)
    setStorageLimitBytes(data.storageLimitBytes ?? 10 * 1024 * 1024 * 1024)
    setInviteCode(data.inviteCode ?? null)
    setPendingJoinRequests(data.pendingJoinRequests ?? [])
    setLoading(false)
  }

  async function loadActivity() {
    setActivityLoading(true)
    try {
      const res = await fetch(`/api/bands/${bandId}/activity`)
      if (res.ok) {
        const { items } = await res.json()
        setActivityItems(items ?? [])
      }
    } finally {
      setActivityLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) {
      if (!user) { router.replace('/auth'); return }
      loadBand()
    }
  }, [authLoading, user, bandId]) // eslint-disable-line

  // Show band welcome modal once
  const showBandWelcome =
    !showWelcomeDismissed &&
    !authLoading &&
    !!profile &&
    !profile.onboarding?.band_seen

  // Close member menu on outside click
  useEffect(() => {
    if (!memberMenu) return
    function handler() { setMemberMenu(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [memberMenu])

  // ── Actions ──────────────────────────────────────────────────────────────────
  async function handleCopyInviteCode() {
    if (!inviteCode) return
    setInviteCopying(true)
    try {
      await navigator.clipboard.writeText(inviteCode)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    } catch { /* ignore */ }
    finally { setInviteCopying(false) }
  }

  async function handleRegenerateInviteCode() {
    if (myRole !== 'owner' || regeneratingCode) return
    if (!window.confirm('Regenerate invite code? The old code will stop working immediately.')) return
    setRegeneratingCode(true)
    try {
      const res = await fetch(`/api/bands/${bandId}/invite-code`, { method: 'POST' })
      if (!res.ok) return
      const { invite_code } = await res.json()
      setInviteCode(invite_code)
    } finally {
      setRegeneratingCode(false)
    }
  }

  async function handleResolveJoinRequest(requestId: string, action: 'approve' | 'reject') {
    if (myRole !== 'owner' || resolvingRequestId) return
    setResolvingRequestId(requestId)
    try {
      const res = await fetch(`/api/bands/${bandId}/join-requests/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) return
      await loadBand()
    } finally {
      setResolvingRequestId(null)
    }
  }

  async function handleSaveRoleLabel(memberId: string) {
    const label = editRoleLabel.trim()
    setEditingMember(null)
    await fetch(`/api/bands/${bandId}/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_label: label || null, role_color: null }),
    })
    loadBand()
  }

  async function handleRemoveMember(memberId: string) {
    setMemberMenu(null)
    await fetch(`/api/bands/${bandId}/members/${memberId}`, { method: 'DELETE' })
    loadBand()
  }

  async function handleDeleteProject() {
    if (!deleteModal || deleteConfirmName !== deleteModal.name) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch(`/api/projects/${deleteModal.id}`, { method: 'DELETE' })
      if (!res.ok) { setDeleteError((await res.json().catch(() => ({}))).error ?? 'Delete failed'); return }
      setProjects(prev => prev.filter(p => p.id !== deleteModal.id))
      setDeleteModal(null); setDeleteConfirmName('')
    } catch { setDeleteError('Network error') }
    finally { setDeleting(false) }
  }

  function startBandRename() {
    if (!band || myRole !== 'owner') return
    setBandNameValue(band.name)
    setBandNameEditing(true)
    setTimeout(() => { bandNameInputRef.current?.select() }, 0)
  }

  async function commitBandRename() {
    if (!band) return
    const trimmed = bandNameValue.trim()
    setBandNameEditing(false)
    if (!trimmed || trimmed === band.name) return
    try {
      const res = await fetch(`/api/bands/${bandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const { band: updated } = await res.json()
        setBand(updated)
        setBandNameFlash(true)
        setTimeout(() => setBandNameFlash(false), 400)
      }
    } catch { /* ignore */ }
  }

  // ── Audio playback ───────────────────────────────────────────────────────────
  const handlePlay = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    const project = projectsRef.current.find(p => p.id === projectId)
    if (!project) return

    // No tracks → nothing to play
    if (!project.first_track_id) return

    // Pause / stop if clicking currently playing or loading project
    if (playingProjectId === project.id || loadingProjectId === project.id) {
      stopPlayback()
      setPlayingProjectId(null)
      setLoadingProjectId(null)
      return
    }

    stopPlayback()
    setPlayingProjectId(null)
    setLoadingProjectId(project.id)
    setErrorProjectId(null)

    const gen = playbackGenRef.current
    const audio = new Audio()
    audioRef.current = audio
    const pid = project.id
    const isStale = () => gen !== playbackGenRef.current

    function showError() {
      if (isStale()) return
      setLoadingProjectId(null)
      setPlayingProjectId(null)
      setErrorProjectId(pid)
      setTimeout(() => setErrorProjectId(prev => prev === pid ? null : prev), 2000)
    }

    audio.oncanplay = () => {
      if (isStale()) return
      audio.play().catch(err => {
        if (isStale()) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        showError()
      })
    }
    audio.onplaying = () => {
      if (isStale()) return
      setLoadingProjectId(null)
      setPlayingProjectId(pid)
    }
    audio.onended = () => {
      if (isStale()) return
      setPlayingProjectId(null)
    }
    audio.onerror = () => {
      if (isStale()) return
      const err = audio.error
      if (err?.code === MediaError.MEDIA_ERR_ABORTED) return
      showError()
    }

    audio.src = `/api/projects/${pid}/mix`
  }, [playingProjectId, loadingProjectId])

  const openProject = useCallback((projectId: string) => {
    router.push(`/band/${bandId}/project/${projectId}`)
  }, [bandId, router])

  const openQuickPeek = useCallback((e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    const p = projectsRef.current.find(x => x.id === projectId)
    if (p) setPreviewProject(p)
  }, [])

  const openDeleteProject = useCallback((projectId: string, name: string) => {
    setDeleteModal({ id: projectId, name })
    setDeleteConfirmName('')
    setDeleteError('')
  }, [])

  const openRenameProject = useCallback((projectId: string, name: string) => {
    setRenameModal({ id: projectId, name })
  }, [])

  const handleProjectRenamed = useCallback((projectId: string, name: string) => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, name } : p))
    setPreviewProject(prev => prev?.id === projectId ? { ...prev, name } : prev)
    setRenameModal(null)
  }, [])

  const updateProjectMeta = useCallback((projectId: string, patch: { bpm: number | null; key: string | null }) => {
    setProjects(prev => prev.map(x => x.id === projectId ? { ...x, ...patch } : x))
  }, [])

  const handleRoadmapChange = useCallback((roadmap: ProjectRoadmap) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== previewProjectRef.current?.id) return p
      return {
        ...p,
        roadmap_configured: roadmap.configured,
        roadmap_steps: roadmap.steps.map(s => ({ name: s.name })),
        roadmap_step_index: roadmap.stepIndex,
        stage_since: roadmap.stageSince,
      }
    }))
    setPreviewProject(prev => {
      if (!prev || prev.id !== previewProjectRef.current?.id) return prev
      return {
        ...prev,
        roadmap_configured: roadmap.configured,
        roadmap_steps: roadmap.steps.map(s => ({ name: s.name })),
        roadmap_step_index: roadmap.stepIndex,
        stage_since: roadmap.stageSince,
      }
    })
  }, [])

  const handleChecklistPreviewChange = useCallback((
    cardTasks: { id: string; text: string; assignee_id: string | null }[],
    myDone: number,
    myTotal: number,
  ) => {
    const pid = previewProjectRef.current?.id
    if (!pid) return
    setProjects(prev => prev.map(p =>
      p.id === pid ? { ...p, checklist_card_tasks: cardTasks, checklist_my_done: myDone, checklist_my_total: myTotal } : p
    ))
    setPreviewProject(prev => prev?.id === pid ? {
      ...prev,
      checklist_card_tasks: cardTasks,
      checklist_my_done: myDone,
      checklist_my_total: myTotal,
    } : prev)
  }, [])

  const bandMembersForPanel = useMemo(() => members.map(m => ({
    user_id: m.user_id,
    username: m.profiles?.username ?? m.user_id,
    display_name: m.profiles?.display_name ?? null,
  })), [members])

  const initialRoadmapForPreview = useMemo(() => {
    if (!previewProject?.roadmap_configured) return null
    return {
      configured: true,
      steps: previewProject.roadmap_steps,
      stepIndex: previewProject.roadmap_step_index,
      stageSince: previewProject.stage_since,
    }
  }, [previewProject])

  const groupedActivity = useMemo(() => {
    const groups: Array<{ date: string; items: ActivityItem[] }> = []
    for (const item of activityItems) {
      const date = formatGroupDate(item.created_at)
      const last = groups[groups.length - 1]
      if (last && last.date === date) last.items.push(item)
      else groups.push({ date, items: [item] })
    }
    return groups
  }, [activityItems])

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true
      if (p.key?.toLowerCase().includes(q)) return true
      if (p.bpm != null && String(p.bpm).includes(q)) return true
      return false
    })
  }, [projects, projectSearch])

  useEffect(() => {
    if (activeTab !== 'projects') return
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        projectSearchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTab])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const storagePct = Math.min(100, (stats.storage_bytes / storageLimitBytes) * 100)
  const bandColor = band ? avatarColor(band.name, palette) : 'var(--ember)'
  const bandInitials = band ? avatarInitials(band.name, 'band') : '??'
  const roleLabel = myRole === 'owner' ? 'OWNER' : myRole.toUpperCase() || 'MEMBER'

  if (authLoading || loading) return <BrandSpinner />

  if (error) {
    const isAccessDenied = error === 'access_denied'
    return (
      <ResourceErrorScreen
        crumbs={<span className="text-muted-foreground">Band</span>}
        accessDenied={isAccessDenied}
        title={isAccessDenied ? "You're not in this band" : 'Band not found'}
        description={
          isAccessDenied
            ? "This band exists, but you're not a member. Ask an owner to add you or share an invite code."
            : "This band doesn't exist or the link is broken."
        }
        actions={[
          { label: '← My bands', href: '/', primary: true },
          ...(isAccessDenied
            ? [{ label: 'Join a band with a code', href: '/dashboard' }]
            : []),
        ]}
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      <AppHeader
        crumbs={<span className="text-foreground truncate">{band?.name}</span>}
        right={
          <TbButton variant="primary" className="hidden sm:inline-flex items-center gap-1.5" onClick={() => setShowNewProject(true)}>
            <IconPlus size={12} />
            New Project
          </TbButton>
        }
      />

      {/* Band hero */}
      <section className="border-b border-border bg-surface/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] gap-6 items-end">
          <div
            className="size-16 grid place-items-center font-display font-bold text-2xl text-background shrink-0"
            style={{ backgroundColor: bandColor }}
          >
            {bandInitials}
          </div>
          <div className="min-w-0">
            {band && (
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                ON TRACKBASE SINCE {formatFoundedHero(band.created_at)}
              </div>
            )}
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl uppercase tracking-tighter m-0 min-w-0">
              {bandNameEditing ? (
                <input
                  ref={bandNameInputRef}
                  value={bandNameValue}
                  onChange={e => setBandNameValue(e.target.value.slice(0, 50))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitBandRename()
                    if (e.key === 'Escape') setBandNameEditing(false)
                  }}
                  onBlur={commitBandRename}
                  className="font-display text-3xl sm:text-4xl lg:text-5xl uppercase tracking-tighter bg-background border border-ember px-2 py-1 outline-none w-full max-w-full"
                />
              ) : (
                <span
                  className={`inline-flex items-center gap-2 max-w-full group ${myRole === 'owner' ? 'cursor-text' : ''}`}
                  onDoubleClick={myRole === 'owner' ? startBandRename : undefined}
                >
                  <span className={`truncate transition-colors ${bandNameFlash ? 'text-ember' : ''}`}>
                    {band?.name}
                  </span>
                  {myRole === 'owner' && (
                    <button
                      type="button"
                      onClick={startBandRename}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-ember bg-transparent border-0 cursor-pointer p-0"
                      title="Rename band"
                      aria-label="Rename band"
                    >
                      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </span>
              )}
            </h1>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
              {projects.length} PROJECT{projects.length !== 1 ? 'S' : ''} · {members.length} MEMBER{members.length !== 1 ? 'S' : ''} · {roleLabel}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border border border-border text-center w-full lg:w-auto">
            {[
              [stats.branches, 'BRANCHES'],
              [stats.merges, 'MERGES'],
              [stats.comments, 'COMMENTS'],
              [stats.tracks, 'TRACKS'],
            ].map(([n, l]) => (
              <div key={l as string} className="bg-background px-3 sm:px-4 py-3">
                <div className="font-display text-xl sm:text-2xl text-foreground tabular-nums">{n as number}</div>
                <div className="text-[8px] uppercase tracking-widest text-muted-foreground mt-1">{l as string}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex overflow-x-auto">
            {(['projects', 'activity'] as const).map(tab => {
              const isActive = activeTab === tab
              const count = tab === 'projects' ? projects.length : totalActivity
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => switchTab(tab)}
                  className={`px-4 sm:px-5 h-11 text-[10px] uppercase tracking-widest border-b-2 transition whitespace-nowrap ${
                    isActive ? 'border-ember text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab}
                  {count > 0 && (
                    <span className={`ml-2 tabular-nums ${isActive ? 'text-ember' : 'text-muted-foreground/60'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground hidden sm:block shrink-0 tabular-nums">
            STORAGE {formatBytes(stats.storage_bytes)} / {formatLimit(storageLimitBytes)}
          </div>
        </div>
      </section>

      <div className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">
        {/* Main column */}
        <div className="min-w-0">
          {activeTab === 'projects' ? (
            <div>
              <div className="flex items-center justify-between mb-3 gap-3">
                <SectionLabel>
                  {projectSearch.trim()
                    ? `${filteredProjects.length} OF ${projects.length} PROJECT${projects.length !== 1 ? 'S' : ''}`
                    : `${projects.length} PROJECT${projects.length !== 1 ? 'S' : ''}`}
                </SectionLabel>
                <TbButton variant="primary" className="sm:hidden" onClick={() => setShowNewProject(true)}>
                  + New
                </TbButton>
              </div>
              <div className="flex items-center border border-border bg-surface/60 px-3 h-10 mb-4 focus-within:border-ember transition-colors">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-3 shrink-0">Search</span>
                <input
                  ref={projectSearchRef}
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Find a project…"
                  aria-label="Search projects"
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60 outline-none text-foreground min-w-0"
                />
                {projectSearch ? (
                  <button
                    type="button"
                    onClick={() => setProjectSearch('')}
                    className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer p-0 ml-2 shrink-0"
                  >
                    Clear
                  </button>
                ) : (
                  <kbd className="hidden sm:inline text-[10px] uppercase tracking-widest text-muted-foreground/60 ml-2 shrink-0 border border-border px-1.5 py-0.5 bg-background">
                    ⌘K
                  </kbd>
                )}
              </div>
              <div className="grid gap-px bg-border border border-border overflow-visible isolate">
                {filteredProjects.length === 0 && projectSearch.trim() ? (
                  <div className="bg-background px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground m-0">
                      No projects matching &ldquo;{projectSearch.trim()}&rdquo;
                    </p>
                  </div>
                ) : (
                  filteredProjects.map((p, i) => (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      index={i}
                      playing={playingProjectId === p.id}
                      loading={loadingProjectId === p.id}
                      error={errorProjectId === p.id}
                      onPlay={handlePlay}
                      onOpen={openProject}
                      onQuick={openQuickPeek}
                      onRename={openRenameProject}
                      onDelete={openDeleteProject}
                      onMetaUpdated={updateProjectMeta}
                      isOwner={myRole === 'owner'}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setShowNewProject(true)}
                  className="bg-background px-4 py-8 flex flex-col items-center justify-center gap-2 border-0 hover:bg-surface transition-colors text-center w-full"
                >
                  <div className="size-8 border border-border grid place-items-center text-muted-foreground">
                    <IconPlus size={14} />
                  </div>
                  <span className="text-sm text-muted-foreground hover:text-ember transition-colors font-medium">
                    Start a new project
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    Upload stems or start blank
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div>
              <SectionLabel>ALL ACTIVITY</SectionLabel>
              {activityLoading ? (
                <p className="text-sm text-muted-foreground mt-4 m-0">Loading activity…</p>
              ) : activityItems.length === 0 ? (
                <p className="text-sm text-muted-foreground/70 mt-4 m-0">No activity yet.</p>
              ) : (
                <div className="mt-4 border border-border bg-surface divide-y divide-border">
                  {groupedActivity.map(group => (
                    <div key={group.date}>
                      <div className="px-4 py-2 bg-background border-b border-border">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{group.date}</span>
                      </div>
                      {group.items.map(item => (
                        <div
                          key={item.id}
                          className="grid grid-cols-1 sm:grid-cols-[80px_1fr_auto] sm:items-center gap-2 sm:gap-4 px-4 py-3 text-xs hover:bg-background transition-colors"
                        >
                          <span className={`text-[9px] font-bold tracking-widest uppercase ${activityColorClass(item.action)}`}>
                            {activityCategoryLabel(item.action)}
                          </span>
                          <div className="min-w-0">
                            <span className="text-foreground font-bold">@{item.username}</span>{' '}
                            <span className="text-muted-foreground">
                              {activityDescriptionParts(
                                item.action,
                                item.subject,
                                item.detail,
                                item.project_name,
                              ).map((part, i) => (
                                <span key={i} className={part.emphasis ? 'text-foreground' : undefined}>
                                  {part.text}
                                </span>
                              ))}
                            </span>
                          </div>
                          <span className="text-muted-foreground tabular-nums sm:text-right">{formatRelative(item.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-6 lg:space-y-8 min-w-0">
          {/* Members */}
          <div>
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <SectionLabel>MEMBERS</SectionLabel>
                {myRole === 'owner' && pendingJoinRequests.length > 0 && (
                  <span className="text-[9px] font-bold uppercase tracking-widest bg-ember text-white px-1.5 py-0.5 shrink-0">
                    {pendingJoinRequests.length} pending
                  </span>
                )}
              </div>
            </div>

            {myRole === 'owner' && pendingJoinRequests.length > 0 && (
              <div className="mb-3 border border-ember/40 bg-ember-soft/30">
                <div className="px-3 py-2 border-b border-ember/20 text-[9px] font-bold uppercase tracking-widest text-ember">
                  Join requests
                </div>
                <div className="divide-y divide-border">
                  {pendingJoinRequests.map(req => {
                    const username = req.profile?.username ?? 'user'
                    const initials = avatarInitials(username, 'user')
                    return (
                      <div key={req.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="size-8 bg-surface-2 grid place-items-center text-[10px] font-bold shrink-0">
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold truncate">@{username}</div>
                          <div className="text-[9px] text-muted-foreground">Wants to join</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={resolvingRequestId === req.id}
                            onClick={() => handleResolveJoinRequest(req.id, 'approve')}
                            className="text-[9px] uppercase tracking-widest px-2 py-1 border border-online text-online hover:bg-online/10 bg-transparent cursor-pointer disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={resolvingRequestId === req.id}
                            onClick={() => handleResolveJoinRequest(req.id, 'reject')}
                            className="text-[9px] uppercase tracking-widest px-2 py-1 border border-border text-muted-foreground hover:border-destructive hover:text-destructive bg-transparent cursor-pointer disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="border border-border bg-surface divide-y divide-border">
              {members.map(m => {
                const username = m.profiles?.username ?? 'user'
                const displayName = m.profiles?.display_name ?? username
                const isMe = m.user_id === user?.id
                const isMemberOwner = m.role === 'owner'
                const roleTagColor = m.role_label ? avatarColor(m.role_label, palette) : null
                const memberInitials = avatarInitials(username, 'user')

                return (
                  <div key={m.user_id}>
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <div className="size-8 bg-surface-2 grid place-items-center text-[10px] font-bold shrink-0 relative">
                        {memberInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">
                          {displayName}
                          {isMemberOwner && <span className="text-ember text-[9px] ml-1">★</span>}
                        </div>
                        <div className="text-[9px] text-muted-foreground truncate">@{username}</div>
                      </div>
                      {(m.role_label || isMemberOwner) && (
                        <span
                          className="text-[8px] font-bold tracking-widest border px-1.5 py-0.5 shrink-0 uppercase"
                          style={roleTagColor
                            ? { borderColor: `${roleTagColor}80`, color: roleTagColor }
                            : undefined}
                        >
                          {m.role_label ?? (isMemberOwner ? 'owner' : '')}
                        </span>
                      )}
                      {isMe && (
                        <button
                          type="button"
                          onClick={() => { setEditingMember(m.user_id); setEditRoleLabel(m.role_label ?? '') }}
                          className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-ember bg-transparent border-0 cursor-pointer shrink-0"
                        >
                          Edit
                        </button>
                      )}
                      {myRole === 'owner' && !isMe && (
                        <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setMemberMenu(memberMenu === m.user_id ? null : m.user_id) }}
                            className="size-7 border border-border grid place-items-center text-muted-foreground hover:border-ember hover:text-ember bg-transparent cursor-pointer"
                          >
                            <IconDotsV size={12} />
                          </button>
                          {memberMenu === m.user_id && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] border border-border bg-popover shadow-2xl flex flex-col overflow-hidden">
                              <TbMenuButton danger onClick={() => handleRemoveMember(m.user_id)}>
                                Remove from band
                              </TbMenuButton>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {editingMember === m.user_id && (
                      <div className="flex gap-2 px-3 pb-3 pl-[52px]">
                        <TbInput
                          autoFocus
                          value={editRoleLabel}
                          onChange={e => setEditRoleLabel(e.target.value)}
                          placeholder="guitarist, vocalist…"
                          maxLength={20}
                          className="text-xs py-1.5"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveRoleLabel(m.user_id)
                            if (e.key === 'Escape') setEditingMember(null)
                          }}
                        />
                        <TbButton variant="primary" className="shrink-0" onClick={() => handleSaveRoleLabel(m.user_id)}>Save</TbButton>
                        <TbButton className="shrink-0" onClick={() => setEditingMember(null)}>✕</TbButton>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {myRole === 'owner' && inviteCode && (
              <div className="mt-3 border border-border bg-surface px-3 py-3 space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Invite code
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm tracking-wider text-foreground bg-background border border-border px-3 py-2">
                    {inviteCode}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyInviteCode}
                    disabled={inviteCopying}
                    className={`shrink-0 size-9 border grid place-items-center transition bg-transparent cursor-pointer disabled:opacity-50 ${
                      inviteCopied
                        ? 'border-online text-online'
                        : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
                    }`}
                    aria-label="Copy invite code"
                  >
                    {inviteCopied ? <IconCheck /> : <IconCopy />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground m-0 leading-relaxed">
                  Share this code so others can request to join. You approve each request.
                </p>
                <button
                  type="button"
                  onClick={handleRegenerateInviteCode}
                  disabled={regeneratingCode}
                  className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-ember bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
                >
                  {regeneratingCode ? 'Regenerating…' : 'Regenerate code'}
                </button>
              </div>
            )}
          </div>

          {/* Recent activity — projects tab only */}
          {activeTab === 'projects' && (
            <div>
              <SectionLabel>RECENT ACTIVITY</SectionLabel>
              <div className="mt-3 border border-border bg-surface divide-y divide-border">
                {recentActivity.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70 px-3 py-4 m-0">No activity yet.</p>
                ) : (
                  recentActivity.map(item => (
                    <div key={item.id} className="flex gap-3 px-3 py-2.5">
                      <div
                        className={`size-2 rounded-full shrink-0 mt-1.5 ${activityDotClass(item.action)}`}
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground m-0 leading-relaxed">
                          <span className="font-bold text-foreground">{item.username}</span>
                          {' '}
                          {activityDescriptionParts(
                            item.action,
                            item.subject,
                            item.detail,
                            item.project_name,
                          ).map((part, i) => (
                            <span key={i} className={part.emphasis ? 'text-foreground font-normal' : undefined}>
                              {part.text}
                            </span>
                          ))}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 m-0 tabular-nums">
                          {formatRelative(item.created_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {totalActivity > 5 && (
                <button
                  type="button"
                  onClick={() => switchTab('activity')}
                  className="mt-2 text-[10px] uppercase tracking-widest text-ember hover:underline bg-transparent border-0 cursor-pointer p-0"
                >
                  View all activity →
                </button>
              )}
            </div>
          )}

          {/* Band stats */}
          <div>
            <SectionLabel>BAND STATS</SectionLabel>
            <div className="mt-3 grid grid-cols-2 gap-px bg-border border border-border">
              {[
                { label: 'BRANCHES', value: stats.branches },
                { label: 'MERGES', value: stats.merges },
                { label: 'COMMENTS', value: stats.comments },
                { label: 'TRACKS', value: stats.tracks },
              ].map(stat => (
                <div key={stat.label} className="bg-background px-3 py-3">
                  <div className="text-[8px] uppercase tracking-widest text-muted-foreground">{stat.label}</div>
                  <div className="font-display text-2xl text-foreground tabular-nums mt-1">{stat.value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
                <span>STORAGE</span>
                <span className="tabular-nums text-foreground">
                  {formatBytes(stats.storage_bytes)} / {formatLimit(storageLimitBytes)}
                </span>
              </div>
              <div className="h-1 bg-surface-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    storagePct > 95 ? 'bg-destructive' : storagePct > 80 ? 'bg-chart-2' : 'bg-ember'
                  }`}
                  style={{ width: `${storagePct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Welcome */}
          <div className="border border-ember/30 bg-ember-soft p-4">
            <SectionLabel>WELCOME</SectionLabel>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed m-0">
              This is {band?.name}&apos;s workspace. Songs, people, and activity all live here.
              Click any project to open it, or hit <strong className="text-foreground font-bold">Quick peek</strong> for resources and structure.
            </p>
          </div>
        </aside>
      </div>

      <StatusFooter
        left={<span className="uppercase tracking-widest truncate">{band?.name} · {activeTab.toUpperCase()}</span>}
        right={<span className="uppercase tracking-widest hidden sm:inline">SYNC OK · 24MS</span>}
      />

      {/* Modals */}
      {showNewProject && (
        <NewProjectModal
          bandId={bandId}
          onClose={() => setShowNewProject(false)}
          onCreated={projectId => { setShowNewProject(false); router.push(`/band/${bandId}/project/${projectId}`) }}
        />
      )}

      {renameModal && (
        <RenameProjectModal
          key={renameModal.id}
          projectId={renameModal.id}
          initialName={renameModal.name}
          onClose={() => setRenameModal(null)}
          onRenamed={name => handleProjectRenamed(renameModal.id, name)}
        />
      )}

      {deleteModal && (
        <TbModal onClose={() => { setDeleteModal(null); setDeleteConfirmName('') }}>
          <p className="font-display text-lg uppercase tracking-tight text-foreground mb-3 m-0">
            Delete &ldquo;{deleteModal.name}&rdquo;?
          </p>
          <p className="text-destructive text-xs leading-relaxed mb-4 m-0">
            This will permanently delete all versions, tracks, and comments in this project. Audio files will be removed from storage.
          </p>
          <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Type the project name to confirm:
          </label>
          <TbInput
            value={deleteConfirmName}
            onChange={e => setDeleteConfirmName(e.target.value)}
            placeholder={deleteModal.name}
            autoFocus
            className="mb-4"
          />
          {deleteError && <p className="text-destructive text-xs mb-3 m-0">{deleteError}</p>}
          <div className="flex gap-2 justify-end">
            <TbButton onClick={() => { setDeleteModal(null); setDeleteConfirmName('') }}>Cancel</TbButton>
            <TbButton
              variant="danger"
              onClick={handleDeleteProject}
              disabled={deleteConfirmName !== deleteModal.name || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete project'}
            </TbButton>
          </div>
        </TbModal>
      )}

      <StructurePreviewPanel
        projectId={previewProject?.id ?? null}
        projectName={previewProject?.name ?? ''}
        accentColor={previewProject ? avatarColor(previewProject.name, palette) : 'var(--accent)'}
        bandId={bandId}
        initialRoadmap={initialRoadmapForPreview}
        bandMembers={bandMembersForPanel}
        currentUserId={user?.id ?? null}
        onRoadmapChange={handleRoadmapChange}
        onChecklistPreviewChange={handleChecklistPreviewChange}
        onClose={() => setPreviewProject(null)}
      />

      {/* Onboarding welcome modal */}
      {showBandWelcome && (
        <BandWelcomeModal
          onDismiss={() => {
            setShowWelcomeDismissed(true)
            updateOnboarding('band_seen', true)
          }}
        />
      )}
    </div>
  )
}

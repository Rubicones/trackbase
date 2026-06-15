'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { BandWelcomeModal } from '@/components/onboarding/BandWelcomeModal'
import { StructurePreviewPanel } from '@/components/StructurePreviewPanel'
import { BrandSpinner } from '@/components/BrandSpinner'
import { activityDotColor, activityVerb } from '@/lib/activityFormat'
import { avatarColor, avatarInitials } from '@/lib/avatarTheme'
import { usePalette } from '@/contexts/PaletteContext'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { AppHeader, SectionLabel, StatusFooter } from '@/components/design/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Band { id: string; name: string; created_at: string }

interface EnhancedProject {
  id: string; name: string; bpm: number | null; key: string | null; created_at: string
  track_count: number; total_duration_ms: number; version_count: number
  comment_count: number; last_updated_at: string; first_track_id: string | null
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

function activityColorClass(action: string): string {
  switch (action) {
    case 'merge': return 'text-ember'
    case 'branch': return 'text-chart-3'
    case 'upload': return 'text-chart-2'
    case 'comment': return 'text-chart-5'
    case 'structure': return 'text-chart-4'
    case 'resource':
    case 'resource_update':
    case 'resource_remove': return 'text-chart-4'
    case 'export': return 'text-foreground'
    case 'meta': return 'text-chart-4'
    default: return 'text-muted-foreground'
  }
}

function TbButton({
  children,
  variant = 'ghost',
  className = '',
  type = 'button',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'danger' | 'solid'
}) {
  const base = 'text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none'
  const styles = {
    ghost: 'border border-border text-muted-foreground hover:border-ember hover:text-ember px-3 py-1.5',
    primary: 'bg-ember text-white border border-ember px-3 py-1.5 font-bold hover:brightness-110',
    solid: 'bg-foreground text-background px-3 py-1.5 font-bold uppercase hover:bg-ember transition-colors',
    danger: 'bg-destructive text-destructive-foreground px-3 py-1.5 font-bold',
  }
  return (
    <button type={type} className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

function TbInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-ember placeholder:text-muted-foreground/60 ${props.className ?? ''}`}
    />
  )
}

function TbModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-border bg-popover p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
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

// ─── Project row ──────────────────────────────────────────────────────────────

function ProjectRow({
  project, index, playing, loading, error, onPlay, onOpen, onQuick, onDelete, onMetaUpdated, isOwner,
}: {
  project: EnhancedProject
  index: number
  playing: boolean
  loading: boolean
  error: boolean
  onPlay: (e: React.MouseEvent) => void
  onOpen: () => void
  onQuick: (e: React.MouseEvent) => void
  onDelete?: () => void
  onMetaUpdated: (patch: { bpm: number | null; key: string | null }) => void
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
          onClick={onPlay}
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
          onClick={onOpen}
          className="min-w-0 flex-1 text-left sm:flex-none"
        >
          <div className="font-display text-lg uppercase tracking-tight truncate hover:text-ember transition-colors">
            {project.name}
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
        <TbButton onClick={onQuick}>Quick</TbButton>
        <TbButton variant="solid" onClick={onOpen}>Open ↗</TbButton>
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
            <div className="absolute right-0 top-full mt-2 z-50 w-52 border border-border bg-popover shadow-2xl">
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onOpen() }}
                className="block w-full text-left px-3 py-2 text-[10px] uppercase tracking-widest text-foreground hover:bg-surface transition-colors"
              >
                Open project
              </button>
              <div className="h-px bg-border" />
              <div className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                <ProjectMetaFields
                  projectId={project.id}
                  bpm={project.bpm}
                  keySig={project.key}
                  onUpdated={onMetaUpdated}
                  variant="menu"
                />
              </div>
              {isOwner && (
                <>
                  <div className="h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onDelete?.() }}
                    className="block w-full text-left px-3 py-2 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Delete project
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

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
  const [error, setError] = useState('')

  // ── UI state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'projects' | 'activity'>('projects')
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [playingProjectId, setPlayingProjectId] = useState<string | null>(null)
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null)
  const [errorProjectId, setErrorProjectId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteCopying, setInviteCopying] = useState(false)
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [editRoleLabel, setEditRoleLabel] = useState('')
  const [memberMenu, setMemberMenu] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [previewProject, setPreviewProject] = useState<EnhancedProject | null>(null)
  const [showWelcomeDismissed, setShowWelcomeDismissed] = useState(false)

  // ── Cleanup audio on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
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
    if (!res.ok) { setError('Band not found'); setLoading(false); return }
    const data = await res.json()
    setBand(data.band)
    setProjects(data.projects ?? [])
    setMembers(data.members ?? [])
    setMyRole(data.myRole ?? '')
    setStats(data.stats ?? { branches: 0, merges: 0, comments: 0, storage_bytes: 0, tracks: 0 })
    setRecentActivity(data.recentActivity ?? [])
    setTotalActivity(data.totalActivity ?? 0)
    setStorageLimitBytes(data.storageLimitBytes ?? 10 * 1024 * 1024 * 1024)
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
  async function handleCopyInvite() {
    setInviteCopying(true)
    try {
      const res = await fetch(`/api/bands/${bandId}/invites/current`)
      if (!res.ok) return
      const { invite } = await res.json()
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${invite.token}`)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    } catch { /* ignore */ }
    finally { setInviteCopying(false) }
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

  // ── Audio playback ───────────────────────────────────────────────────────────
  function handlePlay(e: React.MouseEvent, project: EnhancedProject) {
    e.stopPropagation()

    // No tracks → nothing to play
    if (!project.first_track_id) return

    // Pause / stop if clicking currently playing or loading project
    if (playingProjectId === project.id || loadingProjectId === project.id) {
      audioRef.current?.pause()
      setPlayingProjectId(null)
      setLoadingProjectId(null)
      return
    }

    // Stop any currently playing / loading audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.oncanplay = null
      audioRef.current.onplaying = null
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.src = ''
    }
    setPlayingProjectId(null)
    setLoadingProjectId(project.id)
    setErrorProjectId(null)

    const audio = new Audio()
    audioRef.current = audio
    const pid = project.id
    console.log('[play] starting mix for project', pid)

    function showError(reason: string) {
      console.error('[play] playback failed:', reason, 'project:', pid)
      setLoadingProjectId(null)
      setPlayingProjectId(null)
      setErrorProjectId(pid)
      setTimeout(() => setErrorProjectId(prev => prev === pid ? null : prev), 2000)
    }

    audio.oncanplay = () => {
      console.log('[play] canplay fired — resuming')
    }
    audio.onplaying = () => {
      console.log('[play] playing — audio started')
      setLoadingProjectId(null)
      setPlayingProjectId(pid)
    }
    audio.onended = () => {
      console.log('[play] ended')
      setPlayingProjectId(null)
    }
    audio.onerror = () => {
      const err = audio.error
      showError(err ? `MediaError code=${err.code} msg="${err.message}"` : 'unknown')
    }
    audio.onstalled = () => {
      console.warn('[play] stalled — network may be slow, waiting...')
    }

    audio.src = `/api/projects/${pid}/mix`
    console.log('[play] set src, calling play()')
    audio.play().catch(err => {
      showError(err instanceof Error ? err.message : String(err))
    })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const storagePct = Math.min(100, (stats.storage_bytes / storageLimitBytes) * 100)
  const bandColor = band ? avatarColor(band.name, palette) : 'var(--ember)'
  const bandInitials = band ? avatarInitials(band.name, 'band') : '??'
  const roleLabel = myRole === 'owner' ? 'OWNER' : myRole.toUpperCase() || 'MEMBER'

  if (authLoading || loading) return <BrandSpinner />
  if (error) return (
    <div className="min-h-screen grid place-items-center p-6">
      <p className="text-destructive text-sm m-0">{error}</p>
    </div>
  )

  // ── Activity feed (grouped by date) ─────────────────────────────────────────
  const itemsForFeed = activityItems.length > 0 ? activityItems : []
  const groupedActivity: Array<{ date: string; items: ActivityItem[] }> = []
  for (const item of itemsForFeed) {
    const date = formatGroupDate(item.created_at)
    const last = groupedActivity[groupedActivity.length - 1]
    if (last && last.date === date) { last.items.push(item) }
    else { groupedActivity.push({ date, items: [item] }) }
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
                FOUNDED {formatFoundedHero(band.created_at)}
              </div>
            )}
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl uppercase tracking-tighter truncate m-0">
              {band?.name}
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
              <div className="flex items-center justify-between mb-4 gap-3">
                <SectionLabel>{projects.length} PROJECT{projects.length !== 1 ? 'S' : ''}</SectionLabel>
                <TbButton variant="primary" className="sm:hidden" onClick={() => setShowNewProject(true)}>
                  + New
                </TbButton>
              </div>
              <div className="grid gap-px bg-border border border-border overflow-visible isolate">
                {projects.map((p, i) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    index={i}
                    playing={playingProjectId === p.id}
                    loading={loadingProjectId === p.id}
                    error={errorProjectId === p.id}
                    onPlay={e => handlePlay(e, p)}
                    onOpen={() => router.push(`/band/${bandId}/project/${p.id}`)}
                    onQuick={e => { e.stopPropagation(); setPreviewProject(p) }}
                    onDelete={() => { setDeleteModal({ id: p.id, name: p.name }); setDeleteConfirmName(''); setDeleteError('') }}
                    onMetaUpdated={patch => setProjects(prev => prev.map(x => x.id === p.id ? { ...x, ...patch } : x))}
                    isOwner={myRole === 'owner'}
                  />
                ))}
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
              ) : itemsForFeed.length === 0 ? (
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
                            {item.action.replace(/_/g, ' ')}
                          </span>
                          <div className="min-w-0">
                            <span className="text-foreground font-bold">@{item.username}</span>{' '}
                            <span className="text-muted-foreground">{activityVerb(item.action)}</span>{' '}
                            <span className="text-foreground">{item.subject}</span>
                            {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
                            {item.action !== 'comment' && item.project_name && (
                              <span className="text-muted-foreground/70"> · {item.project_name}</span>
                            )}
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
            <div className="flex items-center justify-between mb-3">
              <SectionLabel>MEMBERS</SectionLabel>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="text-[10px] uppercase tracking-widest text-ember hover:underline bg-transparent border-0 cursor-pointer p-0"
              >
                + Invite
              </button>
            </div>
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
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] border border-border bg-popover shadow-2xl py-1">
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(m.user_id)}
                                className="block w-full text-left px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                              >
                                Remove from band
                              </button>
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
            <button
              type="button"
              onClick={handleCopyInvite}
              disabled={inviteCopying}
              className={`w-full mt-3 flex items-center justify-center gap-2 border px-3 py-2 text-[10px] uppercase tracking-widest transition ${
                inviteCopied
                  ? 'border-online text-online'
                  : 'border-border text-muted-foreground hover:border-ember hover:text-ember'
              } bg-transparent cursor-pointer disabled:opacity-50`}
            >
              {inviteCopied ? <IconCheck /> : <IconCopy />}
              {inviteCopied ? 'Copied!' : 'Copy invite link'}
            </button>
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
                        className="size-2 rounded-full shrink-0 mt-1.5"
                        style={{ background: activityDotColor(item.action) }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground m-0 leading-relaxed">
                          <span className="font-bold text-foreground">{item.username}</span>
                          {' '}{activityVerb(item.action)}{' '}
                          <span>{item.subject}</span>
                          {item.detail && <span> · {item.detail}</span>}
                          {item.action !== 'comment' && item.project_name && (
                            <span className="text-muted-foreground/70"> · {item.project_name}</span>
                          )}
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
              Click any project to open it, or hit <strong className="text-foreground font-bold">Quick</strong> for resources and structure.
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
        accentColor={previewProject ? avatarColor(previewProject.name, palette) : 'var(--accent)'}
        bandId={bandId}
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

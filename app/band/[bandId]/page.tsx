'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { StructurePreviewPanel, IconFileDescription } from '@/components/StructurePreviewPanel'
import { BrandSpinner } from '@/components/BrandSpinner'
import { activityDotColor, activityVerb } from '@/lib/activityFormat'
import { avatarColor } from '@/lib/avatarTheme'
import { ThemeAvatar } from '@/components/ThemeAvatar'
import { usePalette } from '@/contexts/PaletteContext'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'

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

function formatFounded(iso: string): string {
  return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' })
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

function IconBranch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <circle cx="3" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9"/>
      <circle cx="3" cy="9" r="1.5" stroke="currentColor" strokeWidth="0.9"/>
      <circle cx="9" cy="3" r="1.5" stroke="currentColor" strokeWidth="0.9"/>
      <path d="M3 4.5v3M3 4.5C3 7 9 7 9 4.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
    </svg>
  )
}

function IconComment({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M1.5 2.5h9a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5H7L4.5 11V8.5H2a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round"/>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div className="modal-card-responsive" style={{ padding: '1.5rem' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-bright)', marginBottom: '1rem' }}>New project</p>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Project name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Summer EP, Track 3…" autoFocus required
              style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>BPM</label>
              <input value={bpm} onChange={e => setBpm(e.target.value)} placeholder="120" type="number" min="40" max="300"
                style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Key</label>
              <input value={key} onChange={e => setKey(e.target.value)} placeholder="C minor"
                style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          </div>
          {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.4rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()}
              style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0.4rem 1rem', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 500, opacity: loading || !name.trim() ? 0.5 : 1 }}>
              {loading ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project, playing, loading, onPlay, onClick, onPreview, onDelete, onMetaUpdated, isOwner,
}: {
  project: EnhancedProject
  playing: boolean
  loading: boolean
  onPlay: (e: React.MouseEvent) => void
  onClick: () => void
  onPreview: (e: React.MouseEvent) => void
  onDelete?: () => void
  onMetaUpdated: (patch: { bpm: number | null; key: string | null }) => void
  isOwner: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [previewTip, setPreviewTip] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <div
      className="project-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-card)' : 'var(--bg-surface)',
        border: `0.5px solid ${hovered ? 'var(--border-light)' : 'var(--border)'}`,
        borderRadius: 12, padding: 20, cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {/* Play button */}
        <button
          onClick={onPlay}
          disabled={loading && !playing}
          className="btn-play-card"
          data-playing={playing ? 'true' : 'false'}
          style={{ opacity: !project.first_track_id ? 0.4 : 1 }}
        >
          {loading ? <IconSpinner /> : playing ? <IconPause /> : <IconPlay />}
        </button>

        {/* Name + tracks */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {project.track_count} track{project.track_count !== 1 ? 's' : ''}
            {project.total_duration_ms > 0 && ` · ${formatDuration(project.total_duration_ms)}`}
          </p>
        </div>

        {/* Card actions */}
        <div className="project-card-header-actions" onClick={e => e.stopPropagation()}>
          <div className="relative shrink-0">
            <button
              type="button"
              className="project-card-ghost-btn"
              onClick={onPreview}
              aria-label="Resources"
              onMouseEnter={() => setPreviewTip(true)}
              onMouseLeave={() => setPreviewTip(false)}
            >
              <IconFileDescription size={16} />
            </button>
            {previewTip && (
              <div
                className="absolute pointer-events-none"
                style={{
                  bottom: '100%', left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 4,
                  background: 'var(--bg-card)', border: '0.5px solid var(--border-light)',
                  borderRadius: 6, padding: '4px 8px',
                  fontSize: 11, color: 'var(--text-sec)',
                  whiteSpace: 'nowrap', zIndex: 20,
                }}
              >Resources</div>
            )}
          </div>

          <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
              className="project-card-ghost-btn"
              style={{ color: hovered ? 'var(--text-muted)' : 'var(--text-dim)' }}
            >
              <IconDotsV />
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '100%', zIndex: 20,
                background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                borderRadius: 8, padding: 4, minWidth: 200,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}>
                <button
                  onClick={() => { setMenuOpen(false); onClick() }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-sec)', borderRadius: 6 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >Open project</button>
                <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
                <div style={{ padding: '4px 8px 8px' }} onClick={e => e.stopPropagation()}>
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
                    <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
                    <button
                      onClick={() => { setMenuOpen(false); onDelete?.() }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', borderRadius: 6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
                    >Delete project</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="project-card-meta">
        <div className="project-card-meta-left">
          {project.bpm != null && (
            <span className="project-card-meta-item">{project.bpm} BPM</span>
          )}
          {project.key && (
            <span className="project-card-meta-item">{project.key}</span>
          )}
        </div>
        <div className="project-card-meta-right">
          <span className="project-card-meta-item">
            <IconBranch />{project.version_count}
          </span>
          <span className="project-card-meta-item">
            <IconComment />{project.comment_count}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 12, marginTop: 'auto' }}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Last edited {formatLastEdited(project.last_updated_at)}
        </span>
      </div>
    </div>
  )
}

// ─── New project card ──────────────────────────────────────────────────────────

function NewProjectCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="new-project-card"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1.5px dashed ${hovered ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12, padding: 20, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, minHeight: 140,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{
        width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        <IconPlus size={16} />
      </div>
      <p style={{ fontSize: 14, color: hovered ? 'var(--accent)' : 'var(--text-muted)', margin: 0, transition: 'color 0.15s', fontWeight: 500 }}>
        Start a new project
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
        Upload stems or start blank
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
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
    if (tab === 'activity' && activityItems.length === 0) loadActivity()
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

    // Pause / stop if clicking currently playing project
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

    const audio = new Audio()
    audioRef.current = audio

    audio.onplaying = () => {
      setLoadingProjectId(null)
      setPlayingProjectId(project.id)
    }
    audio.onended = () => {
      setPlayingProjectId(null)
    }
    audio.onerror = () => {
      setLoadingProjectId(null)
      setPlayingProjectId(null)
    }

    audio.src = `/api/projects/${project.id}/mix`
    audio.play().catch(() => {
      setLoadingProjectId(null)
      setPlayingProjectId(null)
    })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const storagePct = Math.min(100, (stats.storage_bytes / storageLimitBytes) * 100)
  const storageBarColor = storagePct > 95 ? '#ef4444' : storagePct > 80 ? '#F59E0B' : 'var(--accent)'

  if (authLoading || loading) return <BrandSpinner />
  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* ── Topbar ── */}
      <header className="app-topbar band-topbar" style={{ height: 56 }}>
        <div className="breadcrumb-trail">
          <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 0, textDecoration: 'none', fontSize: '0.9375rem', flexShrink: 0 }}>
            <span style={{ color: 'var(--text-sec)', fontWeight: 600, letterSpacing: '-0.03em' }}>track</span>
            <span style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '-0.03em' }}>base</span>
          </a>
          <span style={{ color: 'var(--border-light)', flexShrink: 0 }}>/</span>
          <a href="/dashboard" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none', flexShrink: 0 }}>Bands</a>
          <span style={{ color: 'var(--border-light)', flexShrink: 0 }}>/</span>
          <span className="breadcrumb-band-name">{band?.name}</span>
        </div>
        <div style={{ flex: 1 }} />
        <AvatarDropdown />
      </header>

      {/* ── Main body ── */}
      <div className="band-layout">

        {/* ── Left column ── */}
        <div className="band-main-col">

          {/* Band header */}
          <div className="band-header-row">
            <div className="band-header-identity">
              {/* Avatar */}
              <ThemeAvatar
                seed={band?.name ?? '??'}
                size={80}
                radius={16}
                kind="band"
                className="band-avatar-lg"
              />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
                <h1 className="band-title-lg" style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.2 }}>
                  {band?.name}
                </h1>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, display: 'flex', gap: 0, flexWrap: 'wrap' }}>
                  {band && (
                    <>
                      <span>founded {formatFounded(band.created_at)}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>·</span>
                      <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>·</span>
                      <span>{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="band-header-actions">
              <button
                onClick={() => setShowNewProject(true)}
                className="btn-accent"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', whiteSpace: 'nowrap',
                }}
              >
                <IconPlus size={13} />
                New project
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="tab-bar-scroll">
            {(['projects', 'activity'] as const).map(tab => {
              const isActive = activeTab === tab
              const count = tab === 'projects' ? projects.length : totalActivity
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => switchTab(tab)}
                  className="tab-bar-btn"
                  data-active={isActive ? 'true' : 'false'}
                >
                  <span className="tab-bar-label">
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {count > 0 && (
                      <span className={isActive ? 'accent-pill' : 'accent-pill accent-pill-muted'}>
                        {count}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'projects' ? (
            <div className="card-grid-projects">
              {projects.map(p => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  playing={playingProjectId === p.id}
                  loading={loadingProjectId === p.id}
                  onPlay={e => handlePlay(e, p)}
                  onClick={() => router.push(`/band/${bandId}/project/${p.id}`)}
                  onPreview={e => { e.stopPropagation(); setPreviewProject(p) }}
                  onDelete={() => { setDeleteModal({ id: p.id, name: p.name }); setDeleteConfirmName(''); setDeleteError('') }}
                  onMetaUpdated={patch => setProjects(prev => prev.map(x => x.id === p.id ? { ...x, ...patch } : x))}
                  isOwner={myRole === 'owner'}
                />
              ))}
              <NewProjectCard onClick={() => setShowNewProject(true)} />
            </div>
          ) : (
            /* Activity feed */
            <div>
              {activityLoading ? (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0' }}>Loading activity…</p>
              ) : itemsForFeed.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text-dim)', padding: '20px 0' }}>No activity yet.</p>
              ) : (
                groupedActivity.map(group => (
                  <div key={group.date}>
                    <p style={{
                      fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)',
                      letterSpacing: '0.8px', marginTop: 20, marginBottom: 8, fontWeight: 500,
                    }}>{group.date}</p>
                    {group.items.map(item => (
                      <div key={item.id} style={{ position: 'relative', paddingLeft: 20, paddingBottom: 16 }}>
                        {/* Dot */}
                        <div style={{
                          position: 'absolute', left: 0, top: 6,
                          width: 8, height: 8, borderRadius: '50%',
                          background: activityDotColor(item.action),
                        }} />
                        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.4, margin: '0 0 2px' }}>
                          <span style={{ fontWeight: 500, color: 'var(--accent)' }}>@{item.username}</span>
                          {' '}{activityVerb(item.action)}{' '}
                          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{item.subject}</span>
                          {item.detail && (
                            <span style={{ color: 'var(--text-muted)' }}> · {item.detail}</span>
                          )}
                          {/* For non-comment actions, append the project name */}
                          {item.action !== 'comment' && item.project_name && (
                            <span style={{ color: 'var(--text-dim)' }}> · {item.project_name}</span>
                          )}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                          {formatRelative(item.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div className="band-sidebar">

          {/* Members card */}
          <div className="sidebar-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.8px', fontWeight: 500 }}>Members</span>
              <button
                onClick={handleCopyInvite}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', padding: 0 }}
              >Invite</button>
            </div>

            {members.map((m, idx) => {
              const username = m.profiles?.username ?? 'user'
              const isMe = m.user_id === user?.id
              const isOwner = m.role === 'owner'
              const roleLabelColor = m.role_label ? avatarColor(m.role_label, palette) : null
              const isLast = idx === members.length - 1

              return (
                <div key={m.user_id}>
                  <div
                    className="member-row"
                    style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--border)' }}
                  >
                    {/* Avatar */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <ThemeAvatar seed={username} size={36} shape="circle" kind="user" />
                      {/* Online dot */}
                      <div style={{
                        position: 'absolute', bottom: 0, right: 0,
                        width: 8, height: 8, borderRadius: '50%',
                        background: '#10B981', border: '1.5px solid var(--bg-surface)',
                      }} />
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{username}
                      </p>
                      {(m.role_label || isOwner) && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                          {roleLabelColor && m.role_label && (
                            <span style={{
                              fontSize: 10, padding: '1px 7px', borderRadius: 20,
                              background: `${roleLabelColor}1a`, color: roleLabelColor,
                              border: `0.5px solid ${roleLabelColor}4d`,
                            }}>{m.role_label}</span>
                          )}
                          {isOwner && (
                            <span style={{
                              fontSize: 10, padding: '1px 7px', borderRadius: 20,
                              background: 'var(--bg-card)', color: 'var(--text-muted)',
                              border: '0.5px solid var(--border)',
                            }}>owner</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Edit role (own row) */}
                    {isMe && (
                      <span
                        className="member-row-action"
                        onClick={() => { setEditingMember(m.user_id); setEditRoleLabel(m.role_label ?? '') }}
                        style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}
                      >Edit</span>
                    )}

                    {/* Dots menu (owner can remove others) */}
                    {myRole === 'owner' && !isMe && (
                      <div className="member-row-action" style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={e => { e.stopPropagation(); setMemberMenu(memberMenu === m.user_id ? null : m.user_id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-dim)', borderRadius: 4 }}
                        ><IconDotsV /></button>
                        {memberMenu === m.user_id && (
                          <div style={{
                            position: 'absolute', right: 0, top: '100%', zIndex: 20,
                            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                            borderRadius: 8, padding: 4, minWidth: 160,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                          }}>
                            <button
                              onClick={() => handleRemoveMember(m.user_id)}
                              style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444', borderRadius: 6 }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                            >Remove from band</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline role edit */}
                  {editingMember === m.user_id && (
                    <div style={{ display: 'flex', gap: 6, paddingLeft: 46, paddingBottom: 6 }}>
                      <input
                        autoFocus value={editRoleLabel}
                        onChange={e => setEditRoleLabel(e.target.value)}
                        placeholder="guitarist, vocalist…" maxLength={20}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveRoleLabel(m.user_id); if (e.key === 'Escape') setEditingMember(null) }}
                        style={{ flex: 1, background: 'var(--bg)', border: '0.5px solid var(--accent)', borderRadius: 6, padding: '3px 8px', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                      />
                      <button onClick={() => handleSaveRoleLabel(m.user_id)} style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '3px 10px', color: 'white', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>Save</button>
                      <button onClick={() => setEditingMember(null)} style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 10px', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Copy invite button at bottom */}
            <button
              onClick={handleCopyInvite}
              disabled={inviteCopying}
              style={{
                width: '100%', marginTop: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'transparent',
                border: `0.5px solid ${inviteCopied ? '#10B981' : 'var(--border)'}`,
                borderRadius: 8, padding: '7px 0',
                color: inviteCopied ? '#10B981' : 'var(--text-muted)',
                fontSize: 12, cursor: inviteCopying ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {inviteCopied ? <IconCheck /> : <IconCopy />}
              {inviteCopied ? 'Copied!' : 'Copy invite link'}
            </button>
          </div>

          {/* Recent Activity card — shown on Projects tab only */}
          {activeTab === 'projects' && (
            <div className="sidebar-card">
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 12 }}>Recent Activity</p>
              {recentActivity.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No activity yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recentActivity.map(item => (
                    <div key={item.id} className="activity-row">
                      <div
                        className="activity-dot"
                        style={{ background: activityDotColor(item.action) }}
                      />
                      <div>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                          <span style={{ fontWeight: 500, color: 'var(--text)' }}>{item.username}</span>
                          {' '}{activityVerb(item.action)}{' '}
                          <span>{item.subject}</span>
                          {item.detail && <span> · {item.detail}</span>}
                          {item.action !== 'comment' && item.project_name && (
                            <span style={{ color: 'var(--text-dim)' }}> · {item.project_name}</span>
                          )}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '1px 0 0' }}>
                          {formatRelative(item.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {totalActivity > 5 && (
                <button
                  onClick={() => switchTab('activity')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', padding: '10px 0 0', display: 'block' }}
                >
                  View all activity →
                </button>
              )}
            </div>
          )}

          {/* Band stats card */}
          <div className="sidebar-card">
            <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.8px', fontWeight: 500, marginBottom: 14 }}>Band Stats</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Branches', value: stats.branches },
                { label: 'Merges', value: stats.merges },
                { label: 'Comments', value: stats.comments },
                { label: 'Tracks', value: stats.tracks },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: 'var(--bg-card)', borderRadius: 8, padding: 12,
                }}>
                  <p style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: '0.6px', margin: '0 0 4px' }}>{stat.label}</p>
                  <p style={{ fontSize: 24, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Storage bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Storage</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formatBytes(stats.storage_bytes)} / 10 GB
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-card)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${storagePct}%`,
                background: storageBarColor,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showNewProject && (
        <NewProjectModal
          bandId={bandId}
          onClose={() => setShowNewProject(false)}
          onCreated={projectId => { setShowNewProject(false); router.push(`/band/${bandId}/project/${projectId}`) }}
        />
      )}

      {deleteModal && (
        <div className="modal-overlay">
          <div className="modal-card-responsive" style={{ padding: '1.5rem', width: 400, maxWidth: 'calc(100vw - 32px)' }}>
            <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-bright)', marginBottom: '0.75rem' }}>
              Delete &ldquo;{deleteModal.name}&rdquo;?
            </p>
            <p style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              This will permanently delete all versions, tracks, and comments in this project. Audio files will be removed from storage.
            </p>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Type the project name to confirm:
            </label>
            <input
              value={deleteConfirmName}
              onChange={e => setDeleteConfirmName(e.target.value)}
              placeholder={deleteModal.name}
              autoFocus
              style={{ width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text)', fontSize: 13, outline: 'none', marginBottom: '1rem', boxSizing: 'border-box' }}
            />
            {deleteError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: '0.75rem' }}>{deleteError}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setDeleteModal(null); setDeleteConfirmName('') }}
                style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.4rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              <button
                onClick={handleDeleteProject}
                disabled={deleteConfirmName !== deleteModal.name || deleting}
                style={{
                  background: '#ef4444', border: 'none', borderRadius: 8, padding: '0.4rem 1rem',
                  color: 'white', cursor: deleteConfirmName !== deleteModal.name || deleting ? 'not-allowed' : 'pointer',
                  fontSize: 12, fontWeight: 500,
                  opacity: deleteConfirmName !== deleteModal.name || deleting ? 0.4 : 1,
                }}>
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}

      <StructurePreviewPanel
        projectId={previewProject?.id ?? null}
        accentColor={previewProject ? avatarColor(previewProject.name, palette) : 'var(--accent)'}
        bandId={bandId}
        onClose={() => setPreviewProject(null)}
      />
    </div>
  )
}

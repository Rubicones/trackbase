'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarDropdown } from '@/components/AvatarDropdown'
import { BrandSpinner } from '@/components/BrandSpinner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityItem {
  action: string; subject: string; detail: string | null
  created_at: string; project_name: string | null
}

interface DashboardBand {
  id: string; name: string; created_at: string
  userRole: string; userRoleLabel: string | null
  projectCount: number; memberCount: number; lastUpdated: string
  latestActivity: ActivityItem | null
  storageBytes: number; storageLimitBytes: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColor(str: string): string {
  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#14B8A6']
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}

function activityDotColor(action: string): string {
  switch (action) {
    case 'merge':   return '#10B981'
    case 'branch':  return '#F59E0B'
    case 'comment': return 'var(--accent)'
    case 'upload':  return '#8B5CF6'
    case 'export':  return 'var(--text-dim)'
    default:        return 'var(--text-dim)'
  }
}

function formatActivityLine(action: string, subject: string, detail?: string | null, projectName?: string | null): string {
  const proj = action !== 'comment' && projectName ? ` · ${projectName}` : ''
  switch (action) {
    case 'merge':   return subject.replace(' → ', ' merged into ') + proj
    case 'branch':  return `branch '${subject}' opened` + proj
    case 'comment': return detail ? `comment in '${subject}' at ${detail}` : `comment in '${subject}'`
    case 'upload':  return (detail ? `${subject} · ${detail} uploaded` : `${subject} uploaded`) + proj
    case 'export':  return `${subject} exported` + proj
    default:        return subject + proj
  }
}

function storageBarColor(bytes: number, limit: number): string {
  const pct = bytes / limit
  if (pct > 0.85) return 'var(--danger)'
  if (pct > 0.60) return 'var(--amber)'
  return 'var(--accent)'
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function NewBandModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (bandId: string) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/bands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { band } = await res.json()
      onCreated(band.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card-responsive">
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 16, margin: '0 0 16px' }}>New band</p>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="The Noise, Blue Period…" autoFocus style={inputStyle} />
          {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()}
              style={{ ...confirmBtnStyle, opacity: loading || !name.trim() ? 0.5 : 1 }}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteBandModal({ band, onClose, onDeleted }: {
  band: { id: string; name: string }; onClose: () => void; onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (confirm !== band.name) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/bands/${band.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card-responsive">
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>Delete {band.name}?</p>
        <p style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6, margin: '0 0 16px' }}>
          This permanently deletes all projects, tracks, and versions. This cannot be undone.
        </p>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          Type the band name to confirm:
        </label>
        <input value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder={band.name} autoFocus style={inputStyle} />
        {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8, marginBottom: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleDelete} disabled={confirm !== band.name || loading}
            style={{ ...confirmBtnStyle, background: '#ef4444', opacity: confirm !== band.name || loading ? 0.5 : 1, cursor: confirm !== band.name || loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Deleting…' : 'Delete band'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LeaveBandModal({ band, onClose, onLeft }: {
  band: { id: string; name: string }; onClose: () => void; onLeft: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLeave() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/bands/${band.id}/members/me`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      onLeft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card-responsive">
        <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>Leave {band.name}?</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 16px' }}>
          You'll lose access to all projects in this band.
        </p>
        {error && <p style={{ color: '#f87171', fontSize: 12, margin: '0 0 12px' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleLeave} disabled={loading}
            style={{ ...confirmBtnStyle, background: '#ef4444', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Leaving…' : 'Leave band'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Band card ────────────────────────────────────────────────────────────────

function BandCard({ band, onNavigate, onDelete, onLeave }: {
  band: DashboardBand
  onNavigate: () => void
  onDelete: () => void
  onLeave: () => void
}) {
  const [hov, setHov] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isOwner = band.userRole === 'owner'
  const color = avatarColor(band.name)
  const initials = band.name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
  const roleLabel = band.userRoleLabel ?? (isOwner ? 'Owner' : 'Member')
  const storagePct = band.storageBytes / band.storageLimitBytes
  const activityLine = band.latestActivity
    ? formatActivityLine(
        band.latestActivity.action,
        band.latestActivity.subject,
        band.latestActivity.detail,
        band.latestActivity.project_name,
      )
    : null

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
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onNavigate}
      style={{
        cursor: 'pointer',
        background: 'var(--bg-surface)',
        borderTopWidth: '0.5px',    borderTopStyle: 'solid',
        borderRightWidth: '0.5px',  borderRightStyle: 'solid',
        borderBottomWidth: '0.5px', borderBottomStyle: 'solid',
        borderLeftWidth: '4px',     borderLeftStyle: 'solid',
        borderTopColor:    hov ? color : `${color}33`,
        borderRightColor:  hov ? color : `${color}33`,
        borderBottomColor: hov ? color : `${color}33`,
        borderLeftColor:   color,
        borderRadius: 14,
        padding: '18px 18px 16px 16px',
        transition: 'border-color 0.15s',
        position: 'relative',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Card header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: 10, background: color, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em',
        }}>
          {initials}
        </div>

        {/* Name + role */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, letterSpacing: '-0.02em' }}>
            {band.name}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '1px 0 0' }}>{roleLabel}</p>
        </div>

        {/* Dots menu */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
            style={{
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: menuOpen ? 'var(--bg-card)' : 'transparent',
              border: `0.5px solid ${menuOpen ? 'var(--border)' : 'transparent'}`,
              borderRadius: 7, cursor: 'pointer', color: 'var(--text-dim)', transition: 'background 0.12s',
            }}
          >
            <DotsVIcon />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: 4, minWidth: 160, zIndex: 60,
              boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
            }}>
              <DropItem label="Open band" icon={<OpenIcon />} onClick={() => { setMenuOpen(false); onNavigate() }} />
              <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
              {isOwner
                ? <DropItem label="Delete band" icon={<TrashIcon />} danger onClick={() => { setMenuOpen(false); onDelete() }} />
                : <DropItem label="Leave band"  icon={<LeaveIcon />} danger onClick={() => { setMenuOpen(false); onLeave() }} />
              }
            </div>
          )}
        </div>
      </div>

      {/* Stats tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'PROJECTS', value: band.projectCount },
          { label: 'MEMBERS',  value: band.memberCount },
          { label: 'UPDATED',  value: formatRelative(band.lastUpdated) },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: '10px 14px',
          }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-dim)', margin: '0 0 4px' }}>
              {label}
            </p>
            <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Recent activity row */}
      {band.latestActivity && activityLine && (
        <div style={{
          borderTop: '0.5px solid var(--border)', borderBottom: '0.5px solid var(--border)',
          padding: '10px 0', marginBottom: 12,
          display: 'flex', alignItems: 'center', gap: 8,
          minWidth: 0,
        }}>
          <div style={{
            flexShrink: 0, width: 8, height: 8, borderRadius: '50%',
            background: activityDotColor(band.latestActivity.action),
          }} />
          <p
            title={activityLine}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13, color: 'var(--text-muted)', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {activityLine}
          </p>
        </div>
      )}

      {/* Storage bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Storage</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {formatBytes(band.storageBytes)} / {formatLimit(band.storageLimitBytes)}
          </span>
        </div>
        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(storagePct * 100, 100)}%`,
            borderRadius: 2,
            background: storageBarColor(band.storageBytes, band.storageLimitBytes),
            transition: 'width 0.3s',
          }} />
        </div>
      </div>
    </div>
  )
}

// ─── New band card ────────────────────────────────────────────────────────────

function NewBandCard({ onClick }: { onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        cursor: 'pointer', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'transparent', borderRadius: 14,
        border: `1.5px dashed ${hov ? 'var(--accent)' : 'var(--border)'}`,
        padding: 40, minHeight: 180,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        border: `1px solid ${hov ? 'var(--accent)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: hov ? 'var(--accent)' : 'var(--text-dim)',
        transition: 'border-color 0.15s, color 0.15s', marginBottom: 10,
      }}>
        <PlusIcon size={16} />
      </div>
      <p style={{ fontSize: 14, color: hov ? 'var(--accent)' : 'var(--text-muted)', margin: 0, transition: 'color 0.15s' }}>
        New band
      </p>
    </div>
  )
}

// ─── Drop menu item ───────────────────────────────────────────────────────────

function DropItem({ label, icon, danger, onClick }: {
  label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderRadius: 7, width: '100%', textAlign: 'left', border: 'none',
        color: danger ? '#ef4444' : 'var(--text-sec)', fontSize: 13, cursor: 'pointer',
        background: hov ? (danger ? 'rgba(239,68,68,0.08)' : 'var(--bg-card)') : 'transparent',
        transition: 'background 0.12s',
      }}>
      {icon}{label}
    </button>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
function DotsVIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="4" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="12" r="1.2" fill="currentColor" />
    </svg>
  )
}
function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2.5 4h9M5 4V2.5h4V4M10.5 4l-.5 7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1L3.5 4"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function LeaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function MusicIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M20 36V16l20-4v20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14" cy="36" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="34" cy="32" r="6" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'owner' | 'member' | 'recent'

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [bands, setBands] = useState<DashboardBand[]>([])
  const [totalBands, setTotalBands] = useState(0)
  const [totalProjects, setTotalProjects] = useState(0)
  const [totalCollaborators, setTotalCollaborators] = useState(0)
  const [loadingData, setLoadingData] = useState(true)

  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  const [showNewBand, setShowNewBand] = useState(false)
  const [deletingBand, setDeletingBand] = useState<DashboardBand | null>(null)
  const [leavingBand, setLeavingBand] = useState<DashboardBand | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth')
  }, [authLoading, user, router])

  // Fetch dashboard data
  useEffect(() => {
    if (authLoading || !user) return
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(data => {
        setBands(data.bands ?? [])
        setTotalBands(data.totalBands ?? 0)
        setTotalProjects(data.totalProjects ?? 0)
        setTotalCollaborators(data.totalCollaborators ?? 0)
      })
      .finally(() => setLoadingData(false))
  }, [authLoading, user])

  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 3000)
  }

  // Filter + search
  const filteredBands = bands
    .filter(b => {
      if (filter === 'owner')  return b.userRole === 'owner'
      if (filter === 'member') return b.userRole === 'member'
      return true
    })
    .filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (filter === 'recent') {
        const aAct = a.latestActivity?.created_at ?? a.lastUpdated
        const bAct = b.latestActivity?.created_at ?? b.lastUpdated
        return bAct.localeCompare(aAct)
      }
      return b.lastUpdated.localeCompare(a.lastUpdated)
    })

  if (authLoading) return <BrandSpinner />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Top bar */}
      <header className="app-topbar">
        <button
          onClick={() => router.push('/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
        >
          <span style={{ color: 'var(--text-sec)', fontWeight: 600, letterSpacing: '-0.03em', fontSize: '1rem' }}>track</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '-0.03em', fontSize: '1rem' }}>base</span>
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {}}
          className="topbar-hide-mobile"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px',
            background: 'transparent', border: '0.5px solid var(--border)',
            borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
          }}
        >
          Feedback
        </button>
        <AvatarDropdown />
      </header>

      {/* Page content */}
      <div className="page-shell">

        {/* Page header row */}
        <div className="page-header-row">
          {/* Left: title + subtitle */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="page-title-lg" style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', letterSpacing: '-0.03em' }}>
              Your bands
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
              {totalBands} band{totalBands !== 1 ? 's' : ''} · {totalProjects} project{totalProjects !== 1 ? 's' : ''} · {totalCollaborators} collaborator{totalCollaborators !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Right: search + new band */}
          <div className="page-header-actions">
            {/* Search */}
            <div className="search-field">
              <span style={{
                position: 'absolute', left: 10, color: 'var(--text-dim)', pointerEvents: 'none',
                display: 'flex', alignItems: 'center',
              }}>
                <SearchIcon />
              </span>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search bands"
                className="search-input"
              />
              <span className="search-kbd" style={{
                position: 'absolute', right: 10,
                display: 'flex', alignItems: 'center', gap: 2,
                background: 'var(--bg-card)', border: '0.5px solid var(--border)',
                borderRadius: 5, padding: '2px 6px', fontSize: 11, color: 'var(--text-dim)',
                pointerEvents: 'none', letterSpacing: '0.02em',
              }}>
                ⌘K
              </span>
            </div>

            {/* New band button */}
            <button
              onClick={() => setShowNewBand(true)}
              className="btn-new-band"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 34, padding: '0 14px',
                background: 'var(--accent)', border: 'none',
                borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 500,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <PlusIcon size={12} />
              New band
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="filter-tabs-row">
          {([
            { id: 'all',    label: 'All' },
            { id: 'owner',  label: 'Owner' },
            { id: 'member', label: 'Member' },
            { id: 'recent', label: 'Recently active' },
          ] as { id: FilterTab; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              style={{
                padding: '6px 14px', borderRadius: 20, border: `0.5px solid ${filter === tab.id ? 'var(--border-light)' : 'var(--border)'}`,
                background: filter === tab.id ? 'var(--bg-surface)' : 'var(--bg-card)',
                color: filter === tab.id ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: filter === tab.id ? 500 : 400,
                fontSize: 13, cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loadingData ? (
          <BrandSpinner fullscreen={false} />
        ) : bands.length === 0 ? (
          /* Empty state */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '100px 0', gap: 12,
          }}>
            <div style={{ color: 'var(--text-dim)' }}><MusicIcon /></div>
            <p style={{ fontSize: 20, color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>No bands yet</p>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', margin: 0, textAlign: 'center', maxWidth: 320 }}>
              Create your first band or join one with an invite link
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button
                onClick={() => setShowNewBand(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                <PlusIcon /> Create a band
              </button>
              <button
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 16px', background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
              >
                Join with invite link
              </button>
            </div>
          </div>
        ) : filteredBands.length === 0 && search ? (
          /* No search results */
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            No bands matching &ldquo;{search}&rdquo;
          </div>
        ) : (
          /* Card grid */
          <div className="card-grid-2">
            {filteredBands.map(band => (
              <BandCard
                key={band.id}
                band={band}
                onNavigate={() => router.push(`/band/${band.id}`)}
                onDelete={() => setDeletingBand(band)}
                onLeave={() => setLeavingBand(band)}
              />
            ))}
            {/* New band card — only shown in All tab with no search query */}
            {filter === 'all' && !search && (
              <NewBandCard onClick={() => setShowNewBand(true)} />
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewBand && (
        <NewBandModal
          onClose={() => setShowNewBand(false)}
          onCreated={id => { setShowNewBand(false); router.push(`/band/${id}`) }}
        />
      )}
      {deletingBand && (
        <DeleteBandModal
          band={deletingBand}
          onClose={() => setDeletingBand(null)}
          onDeleted={() => {
            const name = deletingBand.name
            setBands(prev => prev.filter(b => b.id !== deletingBand.id))
            setTotalBands(n => n - 1)
            setDeletingBand(null)
            showToast(`${name} has been deleted`)
          }}
        />
      )}
      {leavingBand && (
        <LeaveBandModal
          band={leavingBand}
          onClose={() => setLeavingBand(null)}
          onLeft={() => {
            setBands(prev => prev.filter(b => b.id !== leavingBand.id))
            setTotalBands(n => n - 1)
            setLeavingBand(null)
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 'max(24px, env(safe-area-inset-bottom, 0px))', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-card)', border: '0.5px solid var(--border-light)',
          borderRadius: 12, padding: '10px 16px', fontSize: 12, fontWeight: 500,
          color: 'var(--text)', zIndex: 9000, pointerEvents: 'none',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: 'var(--green)' }}>✓</span>{toast}
        </div>
      )}
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg)',
  border: '0.5px solid var(--border)', borderRadius: 8,
  padding: '8px 10px', color: 'var(--text)', fontSize: 14, outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--border)',
  borderRadius: 8, padding: '6px 14px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13,
}
const confirmBtnStyle: React.CSSProperties = {
  background: 'var(--accent)', border: 'none', borderRadius: 8,
  padding: '6px 14px', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500,
}

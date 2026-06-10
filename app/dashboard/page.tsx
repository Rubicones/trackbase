'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarDropdown } from '@/components/AvatarDropdown'

interface BandCard {
  id: string
  name: string
  created_at: string
  membership: { role: string; role_label: string | null }
}

// ─── New band modal ───────────────────────────────────────────────────────────

function NewBandModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (bandId: string) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/bands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { band } = await res.json()
      onCreated(band.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalCard}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-bright)', marginBottom: '1rem' }}>New band</p>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="The Noise, Blue Period…" autoFocus style={inputStyle} />
          {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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

// ─── Delete band modal ────────────────────────────────────────────────────────

function DeleteBandModal({ band, onClose, onDeleted }: {
  band: BandCard; onClose: () => void; onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const matches = confirm === band.name

  async function handleDelete() {
    if (!matches) return
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
    <div style={overlayStyle}>
      <div style={modalCard}>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.75rem' }}>
          Delete {band.name}?
        </p>
        <p style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6, marginBottom: '1.25rem' }}>
          This will permanently delete all projects, tracks, and versions in this band. This cannot be undone.
        </p>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
          Type the band name to confirm:
        </label>
        <input value={confirm} onChange={e => setConfirm(e.target.value)}
          placeholder={band.name} autoFocus style={inputStyle} />
        {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleDelete} disabled={!matches || loading}
            style={{ ...confirmBtnStyle, background: '#ef4444', opacity: !matches || loading ? 0.5 : 1, cursor: !matches || loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Deleting…' : 'Delete band'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Leave band modal ─────────────────────────────────────────────────────────

function LeaveBandModal({ band, onClose, onLeft }: {
  band: BandCard; onClose: () => void; onLeft: () => void
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
    <div style={overlayStyle}>
      <div style={modalCard}>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.75rem' }}>
          Leave {band.name}?
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
          You'll lose access to all projects in this band.
        </p>
        {error && <p style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</p>}
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

// ─── Band card with context menu ──────────────────────────────────────────────

function BandCardItem({ band, onNavigate, onDelete, onLeave }: {
  band: BandCard; onNavigate: () => void; onDelete: () => void; onLeave: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isOwner = band.membership.role === 'owner'

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en', { month: 'short', year: 'numeric' })
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '1rem 1.25rem',
        background: hovered ? 'var(--bg-card)' : 'var(--bg-surface)',
        border: `0.5px solid ${hovered ? 'var(--border-light)' : 'var(--border)'}`,
        borderRadius: 12, transition: 'background 0.15s, border-color 0.15s', position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onNavigate} style={{
        display: 'flex', alignItems: 'center', gap: 14, flex: 1,
        background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
              stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-soft)', margin: 0 }}>{band.name}</p>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: '2px 0 0', textTransform: 'capitalize' }}>
            {band.membership.role_label ?? band.membership.role} · {fmtDate(band.created_at)}
          </p>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ opacity: 0.3, flexShrink: 0 }}>
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Context menu */}
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
          style={{
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: menuOpen ? 'var(--bg-card)' : 'transparent',
            border: `0.5px solid ${menuOpen ? 'var(--border)' : 'transparent'}`,
            borderRadius: 7, cursor: 'pointer', color: 'var(--text-dim)', transition: 'background 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border)' }}
          onMouseLeave={e => { if (!menuOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' } }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="4" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="12" r="1.2" fill="currentColor" />
          </svg>
        </button>

        {menuOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
            borderRadius: 8, padding: 4, minWidth: 160, zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}>
            {isOwner ? (
              <>
                <DropMenuItem icon={<SettingsIcon />} label="Band settings" onClick={() => { setMenuOpen(false); onNavigate() }} />
                <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
                <DropMenuItem icon={<TrashIcon />} label="Delete band" danger onClick={() => { setMenuOpen(false); onDelete() }} />
              </>
            ) : (
              <DropMenuItem icon={<LogoutIcon />} label="Leave band" danger onClick={() => { setMenuOpen(false); onLeave() }} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DropMenuItem({ icon, label, danger, onClick }: {
  icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
        borderRadius: 7, width: '100%', textAlign: 'left',
        background: hov ? (danger ? 'rgba(239,68,68,0.08)' : 'var(--bg-card)') : 'transparent',
        border: 'none', color: danger ? '#ef4444' : 'var(--text-sec)',
        fontSize: 13, cursor: 'pointer', transition: 'background 0.12s',
      }}>
      {icon}{label}
    </button>
  )
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1.06 1.06M10.04 10.04l1.06 1.06M2.9 11.1l1.06-1.06M10.04 3.96l1.06-1.06"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
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
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M5 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [bands, setBands] = useState<BandCard[]>([])
  const [loadingBands, setLoadingBands] = useState(true)
  const [showNewBand, setShowNewBand] = useState(false)
  const [deletingBand, setDeletingBand] = useState<BandCard | null>(null)
  const [leavingBand, setLeavingBand] = useState<BandCard | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth')
  }, [authLoading, user, router])

  useEffect(() => {
    fetch('/api/bands').then(r => r.json()).then(data => setBands(data.bands ?? []))
      .finally(() => setLoadingBands(false))
  }, [])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  if (authLoading) return <Loading />

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', height: 56, padding: '0 1.5rem', gap: 12,
        background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ fontSize: '1rem', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-sec)', fontWeight: 600, letterSpacing: '-0.03em' }}>track</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '-0.03em' }}>base</span>
        </div>
        <div style={{ flex: 1 }} />
        <AvatarDropdown />
      </header>

      <main style={{ maxWidth: 800, width: '100%', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-bright)', letterSpacing: '-0.02em', margin: 0 }}>Your bands</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.2rem', marginBottom: 0 }}>
              Select a band to view projects and members
            </p>
          </div>
          <button onClick={() => setShowNewBand(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent)',
            border: 'none', borderRadius: 8, padding: '0.45rem 0.875rem', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            New band
          </button>
        </div>

        {loadingBands ? (
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        ) : bands.length === 0 ? (
          <div style={{ padding: '4rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <p style={{ marginBottom: '1rem' }}>No bands yet.</p>
            <button onClick={() => setShowNewBand(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent)',
              border: 'none', borderRadius: 8, padding: '0.45rem 0.875rem', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>Create your first band</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bands.map(band => (
              <BandCardItem
                key={band.id} band={band}
                onNavigate={() => router.push(`/band/${band.id}`)}
                onDelete={() => setDeletingBand(band)}
                onLeave={() => setLeavingBand(band)}
              />
            ))}
          </div>
        )}
      </main>

      {showNewBand && (
        <NewBandModal onClose={() => setShowNewBand(false)}
          onCreated={id => { setShowNewBand(false); router.push(`/band/${id}`) }} />
      )}
      {deletingBand && (
        <DeleteBandModal band={deletingBand} onClose={() => setDeletingBand(null)}
          onDeleted={() => {
            const name = deletingBand.name
            setBands(prev => prev.filter(b => b.id !== deletingBand.id))
            setDeletingBand(null); showToast(`${name} has been deleted`)
          }} />
      )}
      {leavingBand && (
        <LeaveBandModal band={leavingBand} onClose={() => setLeavingBand(null)}
          onLeft={() => { setBands(prev => prev.filter(b => b.id !== leavingBand.id)); setLeavingBand(null) }} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-card)', border: '0.5px solid var(--border-light)',
          borderRadius: 12, padding: '10px 16px', fontSize: 12, fontWeight: 500,
          color: 'var(--text-soft)', zIndex: 9000, pointerEvents: 'none',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: 'var(--green)' }}>✓</span>{toast}
        </div>
      )}
    </div>
  )
}

function Loading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
}
const modalCard: React.CSSProperties = {
  background: 'var(--bg-card)', border: '0.5px solid var(--border-light)', borderRadius: 16, padding: '1.5rem', width: 360,
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)',
  borderRadius: 8, padding: '0.5rem 0.75rem', color: 'var(--text)', fontSize: 14, outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8,
  padding: '0.4rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
}
const confirmBtnStyle: React.CSSProperties = {
  background: 'var(--accent)', border: 'none', borderRadius: 8,
  padding: '0.4rem 1rem', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 500,
}

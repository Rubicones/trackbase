'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar } from '@/components/Avatar'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Band {
  id: string
  name: string
  created_at: string
}

interface Project {
  id: string
  name: string
  bpm: number | null
  key: string | null
  created_at: string
}

interface BandMember {
  user_id: string
  role: string
  role_label: string | null
  role_color: string | null
  joined_at: string
  profiles: { username: string; display_name: string | null } | null
}

interface Invite {
  id: string
  token: string
  created_at: string
}

// ─── New project modal ────────────────────────────────────────────────────────

function NewProjectModal({ bandId, onClose, onCreated }: {
  bandId: string
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/bands/${bandId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          bpm: bpm ? parseInt(bpm) : undefined,
          key: key || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { project } = await res.json()
      onCreated(project.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={modal.overlay}>
      <div style={modal.card}>
        <p style={modal.title}>New project</p>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={modal.label}>Project name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Summer EP, Track 3…" autoFocus required style={modal.input} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={modal.label}>BPM</label>
              <input value={bpm} onChange={e => setBpm(e.target.value)} placeholder="120" type="number" min="40" max="300" style={modal.input} />
            </div>
            <div>
              <label style={modal.label}>Key</label>
              <input value={key} onChange={e => setKey(e.target.value)} placeholder="C minor" style={modal.input} />
            </div>
          </div>
          {error && <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={modal.cancelBtn}>Cancel</button>
            <button type="submit" disabled={loading || !name.trim()} style={{ ...modal.confirmBtn, opacity: loading || !name.trim() ? 0.5 : 1 }}>
              {loading ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const modal = {
  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  card: { background: 'var(--bg-card)', border: '0.5px solid var(--border-light)', borderRadius: 16, padding: '1.5rem', width: 360 },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text-bright)', marginBottom: '1rem' },
  label: { display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  input: { width: '100%', background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', color: 'var(--text)', fontSize: 13, outline: 'none' },
  cancelBtn: { background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.4rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 },
  confirmBtn: { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0.4rem 1rem', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 500 },
}

// ─── Role edit inline ─────────────────────────────────────────────────────────

function RoleInput({ bandId, member, onUpdated }: {
  bandId: string
  member: BandMember
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(member.role_label ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  async function save() {
    setEditing(false)
    await fetch(`/api/bands/${bandId}/members/${member.user_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role_label: label || null, role_color: member.role_color }),
    })
    onUpdated()
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 20) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)', fontSize: 11 }}
        title="Edit role"
      >
        {member.role_label ?? member.role} ✏
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      value={label}
      onChange={e => setLabel(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
      placeholder="Drummer, Producer…"
      style={{ fontSize: 11, background: 'var(--bg)', border: '0.5px solid var(--accent)', borderRadius: 4, padding: '1px 6px', color: 'var(--text-soft)', outline: 'none', width: 120 }}
    />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>()
  const router = useRouter()
  const { user, profile, loading: authLoading, signOut } = useAuth()

  const [band, setBand] = useState<Band | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<BandMember[]>([])
  const [myRole, setMyRole] = useState<string>('')
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  async function loadBand() {
    const res = await fetch(`/api/bands/${bandId}`)
    if (!res.ok) { setError('Band not found'); setLoading(false); return }
    const data = await res.json()
    setBand(data.band)
    setProjects(data.projects ?? [])
    setMembers(data.members ?? [])
    setMyRole(data.myRole ?? '')
    setLoading(false)
  }

  async function loadInvites() {
    const res = await fetch(`/api/bands/${bandId}/invites`)
    if (res.ok) { const data = await res.json(); setInvites(data.invites ?? []) }
  }

  useEffect(() => {
    if (!authLoading) {
      if (!user) { router.replace('/auth'); return }
      loadBand()
      loadInvites()
    }
  }, [authLoading, user, bandId]) // eslint-disable-line

  async function handleCreateInvite() {
    const res = await fetch(`/api/bands/${bandId}/invites`, { method: 'POST' })
    if (res.ok) { const d = await res.json(); setInvites(prev => [d.invite, ...prev]) }
  }

  function getInviteUrl(token: string) {
    return `${window.location.origin}/invite/${token}`
  }

  async function copyInvite(token: string) {
    await navigator.clipboard.writeText(getInviteUrl(token))
    setCopiedToken(token)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  function fmtDate(iso: string) {
    const d = new Date(iso)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 86400) return 'today'
    if (diff < 172800) return 'yesterday'
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  }

  if (authLoading || loading) return <Loading />
  if (error) return <ErrorScreen message={error} />

  return (
    <div style={s.root}>
      {/* Topbar */}
      <header style={s.topbar}>
        <a href="/dashboard" style={s.backLink}>
          <span style={{ color: 'var(--text-sec)', fontWeight: 600, letterSpacing: '-0.03em' }}>track</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '-0.03em' }}>base</span>
        </a>
        <span style={{ color: 'var(--border-light)' }}>/</span>
        <span style={s.topbarName}>{band?.name}</span>
        <div style={{ flex: 1 }} />
        {profile && <Avatar username={profile.username} size={28} />}
        <button onClick={async () => { await signOut(); router.replace('/auth') }} style={s.signOutBtn}>Sign out</button>
      </header>

      {/* Body */}
      <div style={s.body}>
        {/* Left: projects */}
        <section style={s.projectsCol}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Projects</h2>
            <button onClick={() => setShowNewProject(true)} style={s.addBtn}>+ New</button>
          </div>

          {projects.length === 0 ? (
            <div style={s.emptyState}>
              No projects yet.
              <button onClick={() => setShowNewProject(true)} style={s.emptyBtn}>Create one →</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projects.map(p => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/band/${bandId}/project/${p.id}`)}
                  style={s.projectCard}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
                >
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <p style={s.projectName}>{p.name}</p>
                    <p style={s.projectMeta}>
                      {[p.bpm && `${p.bpm} BPM`, p.key, fmtDate(p.created_at)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.3, flexShrink: 0 }}>
                    <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Right: members + invites */}
        <aside style={s.membersCol}>
          {/* Members */}
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Members</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: '1.5rem' }}>
            {members.map(m => (
              <div key={m.user_id} style={s.memberRow}>
                <Avatar username={m.profiles?.username ?? 'user'} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={s.memberName}>@{m.profiles?.username ?? '—'}</p>
                  <RoleInput bandId={bandId} member={m} onUpdated={loadBand} />
                </div>
                {m.role === 'owner' && (
                  <span style={s.ownerBadge}>owner</span>
                )}
              </div>
            ))}
          </div>

          {/* Invite link */}
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Invite link</h2>
            <button onClick={handleCreateInvite} style={s.addBtn}>Generate</button>
          </div>
          {invites.length === 0 ? (
            <p style={s.inviteHint}>Generate a link to share with bandmates.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {invites.slice(0, 3).map(inv => (
                <div key={inv.id} style={s.inviteRow}>
                  <span style={s.inviteToken}>{inv.token.slice(0, 12)}…</span>
                  <button
                    onClick={() => copyInvite(inv.token)}
                    style={s.copyBtn}
                  >
                    {copiedToken === inv.token ? '✓ Copied' : 'Copy link'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {showNewProject && (
        <NewProjectModal
          bandId={bandId}
          onClose={() => setShowNewProject(false)}
          onCreated={projectId => {
            setShowNewProject(false)
            router.push(`/band/${bandId}/project/${projectId}`)
          }}
        />
      )}
    </div>
  )
}

function Loading() {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p></div>
}
function ErrorScreen({ message }: { message: string }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#f87171', fontSize: 13 }}>{message}</p></div>
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' },
  topbar: { display: 'flex', alignItems: 'center', height: 56, padding: '0 1.25rem', gap: 10, background: 'var(--bg-surface)', borderBottom: '0.5px solid var(--border)', flexShrink: 0 },
  backLink: { display: 'flex', alignItems: 'center', gap: 2, textDecoration: 'none', fontSize: '0.9375rem' },
  topbarName: { fontSize: 13, color: 'var(--text-sec)' },
  signOutBtn: { background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.3rem 0.75rem', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' },
  body: { display: 'flex', flex: 1, maxWidth: 960, width: '100%', margin: '0 auto', padding: '2rem 1.25rem', gap: '2.5rem', alignItems: 'flex-start' },
  projectsCol: { flex: 1, minWidth: 0 },
  membersCol: { width: 240, flexShrink: 0 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 },
  addBtn: { background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.2rem 0.6rem', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' },
  projectCard: { display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1rem', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, border-color 0.15s', width: '100%' },
  projectName: { fontSize: 13, fontWeight: 500, color: 'var(--text-soft)', margin: 0 },
  projectMeta: { fontSize: 11, color: 'var(--text-dim)', margin: '2px 0 0' },
  memberRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0' },
  memberName: { fontSize: 12, color: 'var(--text-soft)', margin: 0, fontWeight: 500 },
  ownerBadge: { fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'rgba(99,102,241,0.1)', borderRadius: 4, padding: '2px 6px', flexShrink: 0 },
  inviteHint: { fontSize: 12, color: 'var(--text-dim)', margin: 0 },
  inviteRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.625rem', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 8 },
  inviteToken: { flex: 1, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  copyBtn: { background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: 11, fontWeight: 500, cursor: 'pointer', padding: 0, flexShrink: 0 },
  emptyState: { padding: '2.5rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyBtn: { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0.4rem 0.875rem', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
}

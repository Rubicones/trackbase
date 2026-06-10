'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarDropdown } from '@/components/AvatarDropdown'

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

// ─── Avatar color helper ──────────────────────────────────────────────────────

function avatarColor(str: string): string {
  const colors = ['#6366F1','#10B981','#F59E0B','#EC4899','#06B6D4','#8B5CF6','#F97316','#14B8A6']
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff
  return colors[Math.abs(h) % colors.length]
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BandPage() {
  const { bandId } = useParams<{ bandId: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [band, setBand] = useState<Band | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<BandMember[]>([])
  const [myRole, setMyRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  // ── Invite state ────────────────────────────────────────────────────────────
  const [inviteCopied, setInviteCopied] = useState(false)
  const [inviteCopying, setInviteCopying] = useState(false)

  // ── Member inline edit state ────────────────────────────────────────────────
  const [editingMember, setEditingMember] = useState<string | null>(null)
  const [editRoleLabel, setEditRoleLabel] = useState('')

  // ── Member dots menu state ──────────────────────────────────────────────────
  const [memberMenu, setMemberMenu] = useState<string | null>(null)

  // ── Project delete state ────────────────────────────────────────────────────
  const [projectMenu, setProjectMenu] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function loadBand() {
    const res = await fetch(`/api/bands/${bandId}`)
    if (!res.ok) { setError('Band not found'); setLoading(false); return }
    const data = await res.json()
    setBand(data.band)
    setProjects(data.projects ?? [])
    setMembers(data.members ?? [])
    console.log('Members from API:', data.members)
    setMyRole(data.myRole ?? '')
    setLoading(false)
  }

  useEffect(() => {
    if (!authLoading) {
      if (!user) { router.replace('/auth'); return }
      loadBand()
    }
  }, [authLoading, user, bandId]) // eslint-disable-line

  // Close project menu on outside click
  useEffect(() => {
    if (!projectMenu) return
    function handler() { setProjectMenu(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [projectMenu])

  // Close member menu on outside click
  useEffect(() => {
    if (!memberMenu) return
    function handler() { setMemberMenu(null) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [memberMenu])

  async function handleCopyInvite() {
    setInviteCopying(true)
    try {
      const res = await fetch(`/api/bands/${bandId}/invites/current`)
      if (!res.ok) return
      const { invite } = await res.json()
      const url = `${window.location.origin}/invite/${invite.token}`
      await navigator.clipboard.writeText(url)
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
        <AvatarDropdown />
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
                  {myRole === 'owner' && (
                    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => { e.stopPropagation(); setProjectMenu(projectMenu === p.id ? null : p.id) }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                          color: 'var(--text-dim)', borderRadius: 4, fontSize: 16, lineHeight: 1,
                        }}
                      >⋯</button>
                      {projectMenu === p.id && (
                        <div style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 10,
                          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                          borderRadius: 8, padding: 4, minWidth: 160,
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                        }}>
                          <button
                            onClick={() => { setProjectMenu(null); router.push(`/band/${bandId}/project/${p.id}`) }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
                              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                              color: 'var(--text-sec)', borderRadius: 6, textAlign: 'left' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6h8M6.5 3.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Open project
                          </button>
                          <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
                          <button
                            onClick={() => { setProjectMenu(null); setDeleteModal({ id: p.id, name: p.name }); setDeleteConfirmName(''); setDeleteError('') }}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
                              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                              color: 'var(--text-muted)', borderRadius: 6, textAlign: 'left' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#ef4444' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M1.5 3h9M4 3V2a.5.5 0 0 1 .5-.5h3A.5.5 0 0 1 8 2v1M5 5.5v3M7 5.5v3M2.5 3l.5 7.5a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5L10.5 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Delete project
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {myRole !== 'owner' && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ opacity: 0.3, flexShrink: 0 }}>
                      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Right: members + invite */}
        <aside style={s.membersCol}>
          {/* Members */}
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Members</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: '1.5rem' }}>
            {members.map(m => {
              const username = m.profiles?.username ?? 'user'
              const color = avatarColor(username)
              const isMe = m.user_id === user?.id
              const isOwner = m.role === 'owner'
              const roleLabelColor = m.role_label ? avatarColor(m.role_label) : null

              return (
                <div key={m.user_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.45rem 0' }}>
                    {/* Avatar circle */}
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: `${color}33`,
                      border: `1.5px solid ${color}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: 11, fontWeight: 600, color: color, letterSpacing: '0.02em',
                    }}>
                      {username.slice(0, 2).toUpperCase()}
                    </div>

                    {/* Username + tags column */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: 'var(--text-soft)', fontWeight: 500, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        @{username}
                      </span>
                      {(m.role_label || isOwner) && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                          {roleLabelColor && m.role_label && (
                            <span style={{
                              fontSize: 10, padding: '1px 7px', borderRadius: 20,
                              background: `${roleLabelColor}1a`,
                              color: roleLabelColor,
                              border: `0.5px solid ${roleLabelColor}4d`,
                            }}>
                              {m.role_label}
                            </span>
                          )}
                          {isOwner && (
                            <span style={{
                              fontSize: 10, padding: '1px 7px', borderRadius: 20,
                              background: 'var(--bg-card)',
                              color: 'var(--text-muted)',
                              border: '0.5px solid var(--border)',
                            }}>
                              owner
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Edit role (own row only) */}
                    {isMe && (
                      <span
                        onClick={() => { setEditingMember(m.user_id); setEditRoleLabel(m.role_label ?? '') }}
                        style={{ fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
                      >
                        Edit role
                      </span>
                    )}

                    {/* Dots menu (owner can remove other members) */}
                    {myRole === 'owner' && !isMe && (
                      <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={e => { e.stopPropagation(); setMemberMenu(memberMenu === m.user_id ? null : m.user_id) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--text-dim)', borderRadius: 4, fontSize: 16, lineHeight: 1 }}
                        >⋯</button>
                        {memberMenu === m.user_id && (
                          <div style={{
                            position: 'absolute', right: 0, top: '100%', zIndex: 10,
                            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                            borderRadius: 8, padding: 4, minWidth: 160,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                          }}>
                            <button
                              onClick={() => handleRemoveMember(m.user_id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
                                background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                                color: '#ef4444', borderRadius: 6, textAlign: 'left' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                            >
                              Remove from band
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline role edit */}
                  {editingMember === m.user_id && (
                    <div style={{ display: 'flex', gap: 6, paddingLeft: 36, paddingBottom: 6 }}>
                      <input
                        autoFocus
                        value={editRoleLabel}
                        onChange={e => setEditRoleLabel(e.target.value)}
                        placeholder="e.g. guitarist, vocalist"
                        maxLength={20}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveRoleLabel(m.user_id); if (e.key === 'Escape') setEditingMember(null) }}
                        style={{ flex: 1, background: 'var(--bg)', border: '0.5px solid var(--accent)', borderRadius: 6, padding: '3px 8px', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                      />
                      <button
                        onClick={() => handleSaveRoleLabel(m.user_id)}
                        style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '3px 10px', color: 'white', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
                      >Save</button>
                      <button
                        onClick={() => setEditingMember(null)}
                        style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 10px', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
                      >Cancel</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Invite link (owner only) */}
          {myRole === 'owner' && (
            <div style={{ marginTop: '1.5rem' }}>
              <button
                onClick={handleCopyInvite}
                disabled={inviteCopying}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  background: 'transparent',
                  border: `0.5px solid ${inviteCopied ? '#10B981' : 'var(--border)'}`,
                  borderRadius: 8, padding: '0.5rem 0',
                  color: inviteCopied ? '#10B981' : 'var(--text-muted)',
                  fontSize: 12, cursor: inviteCopying ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {inviteCopied ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <rect x="4" y="1" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="0.9"/>
                    <path d="M1 4v7a1 1 0 0 0 1 1h7" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
                  </svg>
                )}
                {inviteCopied ? 'Copied!' : inviteCopying ? 'Getting link…' : 'Copy invite link'}
              </button>
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

      {/* Delete project modal */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-light)', borderRadius: 16, padding: '1.5rem', width: 400 }}>
            <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-bright)', marginBottom: '0.75rem' }}>
              Delete &ldquo;{deleteModal.name}&rdquo;?
            </p>
            <p style={{ fontSize: 13, color: '#ef4444', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              This will permanently delete all versions, tracks, and comments in this project. The audio files will be removed from storage.
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
              <button
                onClick={() => { setDeleteModal(null); setDeleteConfirmName('') }}
                style={{ background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, padding: '0.4rem 1rem', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
              >Cancel</button>
              <button
                onClick={async () => {
                  if (!deleteModal || deleteConfirmName !== deleteModal.name) return
                  setDeleting(true)
                  setDeleteError('')
                  try {
                    const res = await fetch(`/api/projects/${deleteModal.id}`, { method: 'DELETE' })
                    if (!res.ok) {
                      const d = await res.json().catch(() => ({}))
                      setDeleteError(d.error ?? 'Delete failed')
                      return
                    }
                    setProjects(prev => prev.filter(p => p.id !== deleteModal.id))
                    setDeleteModal(null)
                    setDeleteConfirmName('')
                  } catch {
                    setDeleteError('Network error')
                  } finally {
                    setDeleting(false)
                  }
                }}
                disabled={deleteConfirmName !== deleteModal.name || deleting}
                style={{
                  background: '#ef4444', border: 'none', borderRadius: 8, padding: '0.4rem 1rem',
                  color: 'white', cursor: deleteConfirmName !== deleteModal.name || deleting ? 'not-allowed' : 'pointer',
                  fontSize: 12, fontWeight: 500,
                  opacity: deleteConfirmName !== deleteModal.name || deleting ? 0.4 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
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
  body: { display: 'flex', flex: 1, maxWidth: 960, width: '100%', margin: '0 auto', padding: '2rem 1.25rem', gap: '2.5rem', alignItems: 'flex-start' },
  projectsCol: { flex: 1, minWidth: 0 },
  membersCol: { width: 240, flexShrink: 0 },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 },
  addBtn: { background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 6, padding: '0.2rem 0.6rem', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' },
  projectCard: { display: 'flex', alignItems: 'center', gap: 10, padding: '0.875rem 1rem', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'background 0.15s, border-color 0.15s', width: '100%' },
  projectName: { fontSize: 13, fontWeight: 500, color: 'var(--text-soft)', margin: 0 },
  projectMeta: { fontSize: 11, color: 'var(--text-dim)', margin: '2px 0 0' },
  emptyState: { padding: '2.5rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyBtn: { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0.4rem 0.875rem', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
}

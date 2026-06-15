'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectResource } from '@/lib/types'
import { SectionLabel } from '@/components/design/AppShell'
import { ResourcesLyrics } from './ResourcesLyrics'
import { ResourcesFileRow } from './ResourcesFileRow'
import { ResourcesLinkRow } from './ResourcesLinkRow'
import { ResourcesUploadZone, type ResourcesUploadZoneHandle } from './ResourcesUploadZone'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function IconFolder({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconUpload({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5-5 5 5M12 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconLink({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMic({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="21" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="21" x2="15" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconCheck({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  projectName: string
  /** Skip the outer card wrapper — used inside the drawer tab */
  bare?: boolean
  /** Uikit quick-access drawer styling */
  variant?: 'default' | 'drawer'
  /** Hide lyrics block (e.g. when shown elsewhere in reading mode) */
  hideLyrics?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ResourcesCard({ projectId, projectName, bare = false, variant = 'default', hideLyrics = false }: Props) {
  const isDrawer = variant === 'drawer'
  const [resources, setResources] = useState<ProjectResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // + Add dropdown
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const uploadRef = useRef<ResourcesUploadZoneHandle>(null)

  // Add-link inline form
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkUrlError, setLinkUrlError] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)

  // Derived
  const lyrics = resources.find(r => r.type === 'lyrics') ?? null
  const files = resources.filter(r => r.type === 'file')
  const links = resources.filter(r => r.type === 'link')
  const isEmpty = !(!hideLyrics && lyrics) && files.length === 0 && links.length === 0

  // Load resources
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/resources`)
      if (!res.ok) throw new Error('Failed to load')
      const { resources: data } = await res.json()
      setResources(data ?? [])
    } catch {
      setError('Failed to load resources')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // Resource mutation helpers
  function upsertResource(r: ProjectResource) {
    setResources(prev => {
      const idx = prev.findIndex(x => x.id === r.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next }
      return [...prev, r]
    })
  }

  function removeResource(id: string) {
    setResources(prev => prev.filter(r => r.id !== id))
  }

  // Add link
  async function handleAddLink() {
    setLinkUrlError('')
    if (!linkUrl.trim()) { setLinkUrlError('URL is required'); return }
    if (!/^https?:\/\//i.test(linkUrl.trim())) { setLinkUrlError('Please enter a valid URL'); return }
    setLinkSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkUrl.trim(), title: linkTitle.trim() || null }),
      })
      if (res.ok || res.status === 201) {
        const { resource } = await res.json()
        upsertResource(resource)
        setShowLinkForm(false)
        setLinkTitle('')
        setLinkUrl('')
      }
    } finally {
      setLinkSaving(false)
    }
  }

  // Add dropdown item
  function openAddMenu(action: 'file' | 'link' | 'lyrics') {
    setMenuOpen(false)
    if (action === 'file') uploadRef.current?.openFilePicker()
    else if (action === 'link') { setShowLinkForm(true) }
    else if (action === 'lyrics') {
      setShowLyricsTrigger(true)
    }
  }

  const [showLyricsTrigger, setShowLyricsTrigger] = useState(false)

  const inputStyle: CSSProperties = {
    fontSize: 12,
    color: 'var(--text)',
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 5,
    padding: '5px 9px',
    outline: 'none',
  }

  const btnOutline: CSSProperties = {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '5px 12px',
    borderRadius: 6,
    border: '0.5px solid var(--border)',
    background: 'transparent',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    transition: 'color 0.12s, border-color 0.12s',
  }

  function SectionHeader({ children }: { children: React.ReactNode }) {
    if (isDrawer) return <SectionLabel>{children}</SectionLabel>
    return (
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {children}
      </p>
    )
  }

  const content = (
    <div className={isDrawer ? 'space-y-6 text-sm' : undefined}>
      {/* Card header */}
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: isDrawer ? 'flex-end' : 'space-between', marginBottom: loading ? 0 : isEmpty ? 16 : isDrawer ? 0 : 16 }}
        className={isDrawer && !loading && !isEmpty ? 'mb-0' : undefined}
      >
        {!isDrawer && <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Resources</span>}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className={isDrawer ? 'border border-border text-[10px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember px-3 py-1.5 transition inline-flex items-center gap-1 bg-transparent cursor-pointer' : undefined}
            style={isDrawer ? undefined : {
              ...btnOutline,
              fontSize: 12,
              padding: '4px 10px',
            }}
            onMouseEnter={isDrawer ? undefined : e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
            onMouseLeave={isDrawer ? undefined : e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
          >
            <IconPlus size={11} />
            {isDrawer ? 'Add' : 'Add'}
          </button>

          {menuOpen && (
            <div
              className={isDrawer ? 'absolute right-0 top-full mt-1 z-50 min-w-[150px] border border-border bg-popover shadow-2xl py-1' : undefined}
              style={isDrawer ? undefined : {
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                zIndex: 100,
                background: 'var(--bg-card)',
                border: '0.5px solid var(--border-light)',
                borderRadius: 8,
                padding: '4px 0',
                minWidth: 150,
                boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
              }}
            >
              {[
                { key: 'file', Icon: IconUpload, label: 'Add files' },
                { key: 'link', Icon: IconLink, label: 'Add link' },
                ...(!lyrics ? [{ key: 'lyrics', Icon: IconMic, label: 'Edit lyrics' }] : []),
              ].map(({ key, Icon, label }) => (
                <button
                  key={key}
                  onClick={() => openAddMenu(key as 'file' | 'link' | 'lyrics')}
                  className={isDrawer ? 'flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:bg-surface hover:text-foreground bg-transparent border-0 cursor-pointer text-left' : undefined}
                  style={isDrawer ? undefined : {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '7px 12px',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s, color 0.1s',
                  }}
                  onMouseEnter={isDrawer ? undefined : e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                  onMouseLeave={isDrawer ? undefined : e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>Loading…</p>
      ) : error ? (
        <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      ) : (
        <>
          {/* Empty state */}
          {isEmpty && !showLinkForm && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: 6 }}>
              <div style={{ color: 'var(--text-dim)' }}>
                <IconFolder size={28} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No resources yet</p>
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Attach files, links, or lyrics for quick access</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {[
                  { action: 'file', Icon: IconUpload, label: 'Add files' },
                  { action: 'link', Icon: IconLink, label: 'Add link' },
                  { action: 'lyrics', Icon: IconMic, label: 'Add lyrics' },
                ].map(({ action, Icon, label }) => (
                  <button
                    key={action}
                    onClick={() => openAddMenu(action as 'file' | 'link' | 'lyrics')}
                    style={btnOutline}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lyrics section */}
          {( !hideLyrics && (lyrics || showLyricsTrigger)) && (
            <div className={isDrawer ? undefined : undefined}
              style={isDrawer ? undefined : {
                paddingBottom: (files.length > 0 || links.length > 0) ? 16 : 0,
                marginBottom: (files.length > 0 || links.length > 0) ? 16 : 0,
                borderBottom: (files.length > 0 || links.length > 0) ? '0.5px solid var(--border)' : 'none',
              }}
            >
              {isDrawer && lyrics && (
                <SectionHeader>LYRICS{lyrics.updated_at ? ` · edited ${fmtRelative(lyrics.updated_at)}` : ''}</SectionHeader>
              )}
              <ResourcesLyrics
                projectId={projectId}
                projectName={projectName}
                lyrics={lyrics}
                onUpdate={r => { upsertResource(r); setShowLyricsTrigger(false) }}
                autoOpen={showLyricsTrigger}
                showFullByDefault={isDrawer}
                variant={isDrawer ? 'drawer' : 'default'}
              />
            </div>
          )}

          {/* Files list */}
          {files.length > 0 && (
            <div style={{ marginBottom: links.length > 0 ? (isDrawer ? 0 : 16) : 0 }} className={isDrawer ? 'mt-2' : undefined}>
              <SectionHeader>FILES</SectionHeader>
              <div className={isDrawer ? 'mt-2 border border-border divide-y divide-border' : undefined}>
              {files.map((r, i) => (
                <ResourcesFileRow
                  key={r.id}
                  resource={r}
                  projectId={projectId}
                  isLast={isDrawer ? true : i === files.length - 1}
                  onUpdated={upsertResource}
                  onDeleted={removeResource}
                  variant={isDrawer ? 'drawer' : 'default'}
                />
              ))}
              </div>
            </div>
          )}

          {/* Add link inline form */}
          {showLinkForm && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--accent)',
                marginBottom: links.length > 0 ? 8 : 0,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Title (optional)"
                  value={linkTitle}
                  onChange={e => setLinkTitle(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                  onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
                />
                <input
                  autoFocus
                  type="url"
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={e => { setLinkUrl(e.target.value); setLinkUrlError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddLink() }}
                  style={{ ...inputStyle, flex: 2, borderColor: linkUrlError ? 'var(--danger)' : 'var(--border)' }}
                  onFocus={e => { if (!linkUrlError) e.target.style.borderColor = 'var(--accent)' }}
                  onBlur={e => { if (!linkUrlError) e.target.style.borderColor = 'var(--border)' }}
                />
              </div>
              {linkUrlError && <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{linkUrlError}</p>}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  onClick={() => { setShowLinkForm(false); setLinkTitle(''); setLinkUrl(''); setLinkUrlError('') }}
                  style={{ fontSize: 11, color: 'var(--text-dim)', padding: '3px 10px', borderRadius: 5, border: '0.5px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddLink}
                  disabled={linkSaving}
                  style={{ fontSize: 11, color: '#fff', padding: '3px 10px', borderRadius: 5, border: 'none', background: 'var(--accent)', cursor: linkSaving ? 'not-allowed' : 'pointer', opacity: linkSaving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <IconCheck size={11} />
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Links list */}
          {links.length > 0 && (
            <div className={isDrawer ? 'mt-2' : undefined}>
              <SectionHeader>LINKS</SectionHeader>
              <div className={isDrawer ? 'mt-2 space-y-2' : undefined}>
                {links.map((r, i) => (
                  <ResourcesLinkRow
                    key={r.id}
                    resource={r}
                    projectId={projectId}
                    isLast={i === links.length - 1}
                    onUpdated={upsertResource}
                    onDeleted={removeResource}
                    variant={isDrawer ? 'drawer' : 'default'}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Upload zone — always visible at bottom */}
          <div
            className={isDrawer ? 'mt-2' : undefined}
            style={isDrawer ? undefined : {
              marginTop: 16,
              paddingTop: (lyrics || files.length > 0 || links.length > 0 || showLinkForm) ? 16 : 0,
              borderTop: (lyrics || files.length > 0 || links.length > 0 || showLinkForm) ? '0.5px solid var(--border)' : 'none',
            }}
          >
            <ResourcesUploadZone
              ref={uploadRef}
              projectId={projectId}
              onUploadComplete={r => { upsertResource(r) }}
              variant={isDrawer ? 'drawer' : 'default'}
            />
          </div>
        </>
      )}
    </div>
  )

  if (bare) {
    return <div>{content}</div>
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--border-radius-lg, 12px)',
        padding: 20,
        marginTop: 16,
      }}
    >
      {content}
    </div>
  )
}

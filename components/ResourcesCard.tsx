'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectResource } from '@/lib/types'
import { SectionLabel } from '@/components/design/AppShell'
import { TbButton, TbMenuButton } from '@/components/design/TbButton'
import { TbInput } from '@/components/design/TbInput'
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
  /** Hide drag-and-drop upload field (mobile rehearsal — use Add files instead). */
  hideUploadZone?: boolean
  /** Band storage quota reached — block file uploads. */
  storageFull?: boolean
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

export function ResourcesCard({ projectId, projectName, bare = false, variant = 'default', hideLyrics = false, hideUploadZone = false, storageFull = false }: Props) {
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
    if (action === 'file') {
      if (storageFull) return
      uploadRef.current?.openFilePicker()
    }
    else if (action === 'link') { setShowLinkForm(true) }
    else if (action === 'lyrics') {
      setShowLyricsTrigger(true)
    }
  }

  const [showLyricsTrigger, setShowLyricsTrigger] = useState(false)

  function SectionHeader({ children }: { children: React.ReactNode }) {
    if (isDrawer) return <SectionLabel>{children}</SectionLabel>
    return (
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {children}
      </p>
    )
  }

  const showHeaderAdd = !isEmpty || showLinkForm
  const showHeader = !isDrawer || showHeaderAdd

  const content = (
    <div className={isDrawer ? 'space-y-6 text-sm' : undefined}>
      {/* Card header */}
      {showHeader && (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: isDrawer ? 'flex-end' : 'space-between', marginBottom: loading ? 0 : isEmpty ? 16 : isDrawer ? 0 : 16 }}
        className={isDrawer && !loading && !isEmpty ? 'mb-0' : undefined}
      >
        {!isDrawer && <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>Resources</span>}
        {showHeaderAdd && (
        <div className="relative" ref={menuRef}>
          <TbButton className="inline-flex items-center gap-1.5 h-9 px-3" onClick={() => setMenuOpen(v => !v)}>
            <IconPlus size={11} />
            Add
          </TbButton>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] border border-border bg-popover shadow-2xl flex flex-col overflow-hidden">
              {[
                { key: 'file', Icon: IconUpload, label: storageFull ? 'Storage full' : 'Add files', disabled: storageFull },
                { key: 'link', Icon: IconLink, label: 'Add link', disabled: false },
                ...(!lyrics ? [{ key: 'lyrics', Icon: IconMic, label: 'Edit lyrics', disabled: false }] : []),
              ].map(({ key, Icon, label, disabled }) => (
                <TbMenuButton
                  key={key}
                  className="gap-2"
                  disabled={disabled}
                  onClick={() => openAddMenu(key as 'file' | 'link' | 'lyrics')}
                >
                  <Icon size={13} />
                  {label}
                </TbMenuButton>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
      )}

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>Loading…</p>
      ) : error ? (
        <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      ) : (
        <>
          {/* Empty state */}
          {isEmpty && !showLinkForm && (
            <div className="flex flex-col items-center text-center py-10 px-4 gap-3 border border-border bg-surface/40">
              <div className="size-10 border border-border grid place-items-center text-muted-foreground shrink-0">
                <IconFolder size={18} />
              </div>
              <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">
                No resources yet
              </p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 m-0 max-w-[18rem] leading-relaxed">
                Attach WAV / MP3 / MIDI / PDF / DAW files, links, or lyrics
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                {[
                  { action: 'file', Icon: IconUpload, label: storageFull ? 'Storage full' : 'Add files', disabled: storageFull },
                  { action: 'link', Icon: IconLink, label: 'Add link', disabled: false },
                  { action: 'lyrics', Icon: IconMic, label: 'Add lyrics', disabled: false },
                ].map(({ action, Icon, label, disabled }) => (
                  <TbButton
                    key={action}
                    disabled={disabled}
                    className="h-9 px-3 gap-1.5"
                    onClick={() => openAddMenu(action as 'file' | 'link' | 'lyrics')}
                  >
                    <Icon size={12} />
                    {label}
                  </TbButton>
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
            <div className="border border-ember bg-surface p-3 mb-2 space-y-2">
              <div className="flex gap-2">
                <TbInput
                  type="text"
                  placeholder="Title (optional)"
                  value={linkTitle}
                  onChange={e => setLinkTitle(e.target.value)}
                  className="flex-1 text-xs py-1.5"
                />
                <TbInput
                  autoFocus
                  type="url"
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={e => { setLinkUrl(e.target.value); setLinkUrlError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddLink() }}
                  className={`flex-2 text-xs py-1.5 ${linkUrlError ? 'border-destructive focus:border-destructive' : ''}`}
                />
              </div>
              {linkUrlError && (
                <p className="text-[11px] text-destructive m-0">{linkUrlError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <TbButton
                  onClick={() => { setShowLinkForm(false); setLinkTitle(''); setLinkUrl(''); setLinkUrlError('') }}
                >
                  Cancel
                </TbButton>
                <TbButton variant="primary" onClick={handleAddLink} disabled={linkSaving} className="gap-1">
                  <IconCheck size={11} />
                  Add
                </TbButton>
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

          {/* Upload zone — always mounted so Add files / file picker ref works */}
          <div className={hideUploadZone ? 'hidden' : `mt-4 ${!isEmpty || showLinkForm ? 'pt-4 border-t border-border' : ''}`}>
            <ResourcesUploadZone
              ref={uploadRef}
              projectId={projectId}
              hideDropZone={hideUploadZone}
              uploadDisabled={storageFull}
              onUploadComplete={r => { upsertResource(r) }}
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

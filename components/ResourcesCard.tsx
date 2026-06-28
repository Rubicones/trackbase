'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/lib/analytics'
import type { ProjectResource, Version } from '@/lib/types'
import { SectionLabel } from '@/components/design/AppShell'
import { TbButton, TbMenuButton } from '@/components/design/TbButton'
import { TbInput } from '@/components/design/TbInput'
import { ResourcesLyrics } from './ResourcesLyrics'
import { ResourcesFileRow } from './ResourcesFileRow'
import { ResourcesLinkRow } from './ResourcesLinkRow'
import { ResourcesUploadZone, type ResourcesUploadZoneHandle } from './ResourcesUploadZone'
import { SidebarResourceItem } from './SidebarResourceItem'

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

function IconChevronDown({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <polyline
        points="6 9 12 15 18 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ResourcesCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand resources' : 'Collapse resources'}
      className="inline-flex size-6 shrink-0 items-center justify-center border border-border bg-transparent text-muted-foreground/70 transition-colors hover:border-lime hover:text-lime cursor-pointer"
    >
      <IconChevronDown
        size={12}
        className={`transition-transform duration-200 ease-out ${collapsed ? '' : 'rotate-180'}`}
      />
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  projectName: string
  /** Skip the outer card wrapper — used inside the drawer tab */
  bare?: boolean
  /** Uikit quick-access drawer styling */
  variant?: 'default' | 'drawer' | 'sidebar'
  /** Hide lyrics block (e.g. when shown elsewhere in reading mode) */
  hideLyrics?: boolean
  /** Hide drag-and-drop upload field (mobile rehearsal — use Add files instead). */
  hideUploadZone?: boolean
  /** Band storage quota reached — block file uploads. */
  storageFull?: boolean
  /** When set, only show resources attached to this track. */
  filterTrackId?: string | null
  filterTrackName?: string | null
  onClearFilter?: () => void
  /** Branch/track list for context chip pickers. Fetched when omitted. */
  versions?: Version[]
  onNavigateVersion?: (versionId: string) => void
  onNavigateTrack?: (trackId: string, versionId: string) => void
  /** Sidebar collapse toggle — if provided, shows a collapse arrow next to + Add */
  collapsed?: boolean
  onToggleCollapse?: () => void
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

export function ResourcesCard({
  projectId,
  projectName,
  bare = false,
  variant = 'default',
  hideLyrics = false,
  hideUploadZone = false,
  storageFull = false,
  filterTrackId = null,
  filterTrackName = null,
  onClearFilter,
  versions: versionsProp = [],
  onNavigateVersion,
  onNavigateTrack,
  collapsed = false,
  onToggleCollapse,
}: Props) {
  const isDrawer = variant === 'drawer'
  const isSidebar = variant === 'sidebar'
  const [resources, setResources] = useState<ProjectResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [versionsLocal, setVersionsLocal] = useState<Version[]>(() => versionsProp)
  const fetchedVersionsFor = useRef<string | null>(null)

  useEffect(() => {
    if (versionsProp.length > 0) {
      setVersionsLocal(versionsProp)
      fetchedVersionsFor.current = null
    }
  }, [versionsProp])

  useEffect(() => {
    if (versionsProp.length > 0) return
    if (fetchedVersionsFor.current === projectId) return
    fetchedVersionsFor.current = projectId
    let cancelled = false
    fetch(`/api/projects/${projectId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!cancelled && data?.versions) setVersionsLocal(data.versions)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, versionsProp.length])

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
  const allFiles = resources.filter(r => r.type === 'file')
  const allLinks = resources.filter(r => r.type === 'link')
  const matchesFilter = (r: ProjectResource) =>
    !filterTrackId || r.context_track_id === filterTrackId
  const files = allFiles.filter(matchesFilter)
  const links = allLinks.filter(matchesFilter)
  const sidebarAttachments = isSidebar
    ? [...files, ...links].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
    : []
  const isEmpty = !(!hideLyrics && lyrics) && allFiles.length === 0 && allLinks.length === 0
  const isFilteredEmpty = filterTrackId && files.length === 0 && links.length === 0 && !isEmpty

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
        body: JSON.stringify({
          url: linkUrl.trim(),
          title: linkTitle.trim() || null,
        }),
      })
      if (res.ok || res.status === 201) {
        const { resource } = await res.json()
        trackEvent('resource_link_added')
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
    if (isDrawer || isSidebar) return <SectionLabel>{children}</SectionLabel>
    return (
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {children}
      </p>
    )
  }

  const showHeaderAdd = !isEmpty || showLinkForm
  const showHeader = !isSidebar && (!isDrawer || showHeaderAdd)

  const content = (
    <div className={isDrawer || isSidebar ? (isSidebar ? 'space-y-2 text-sm' : 'space-y-4 text-sm') : undefined}>
      {isSidebar && filterTrackId && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-[9px] uppercase tracking-widest text-lime m-0 truncate">
            Filter · {filterTrackName ?? 'track'}
          </p>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {isSidebar && (
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>RESOURCES</SectionLabel>
          <div className="flex items-center gap-1">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen(v => !v)}
                className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:border-lime hover:text-lime transition bg-transparent cursor-pointer"
              >
                <IconPlus size={10} />
                Add
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[130px] border border-border bg-popover shadow-2xl flex flex-col overflow-hidden">
                  {[
                    { key: 'file', Icon: IconUpload, label: storageFull ? 'Storage full' : 'Add files', disabled: storageFull },
                    { key: 'link', Icon: IconLink, label: 'Add link', disabled: false },
                  ].map(({ key, Icon, label, disabled }) => (
                    <TbMenuButton
                      key={key}
                      className="gap-2 text-xs"
                      disabled={disabled}
                      onClick={() => openAddMenu(key as 'file' | 'link')}
                    >
                      <Icon size={12} />
                      {label}
                    </TbMenuButton>
                  ))}
                </div>
              )}
            </div>
            {onToggleCollapse && (
              <ResourcesCollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} />
            )}
          </div>
        </div>
      )}
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

      <div className="tb-accordion-panel" data-state={collapsed ? 'closed' : 'open'}>
        <div className="tb-accordion-panel-inner">
          <div className="tb-accordion-panel-body">
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}>Loading…</p>
      ) : error ? (
        <p style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</p>
      ) : (
        <>
          {/* Empty state */}
          {isEmpty && !showLinkForm && !isSidebar && (
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

          {isSidebar && isEmpty && !showLinkForm && (
            <p className="text-[10px] text-muted-foreground m-0 px-1">No files or links yet</p>
          )}

          {isFilteredEmpty && (
            <p className="text-[10px] text-muted-foreground m-0 px-1">No resources for this track</p>
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

          {isSidebar && showLinkForm && (
            <div className="border border-lime bg-surface p-2 mb-1.5 space-y-1.5">
              <div className="flex flex-col gap-1.5">
                <TbInput
                  type="text"
                  placeholder="Title (optional)"
                  value={linkTitle}
                  onChange={e => setLinkTitle(e.target.value)}
                  className="text-[10px] py-1"
                />
                <TbInput
                  autoFocus
                  type="url"
                  placeholder="https://…"
                  value={linkUrl}
                  onChange={e => { setLinkUrl(e.target.value); setLinkUrlError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddLink() }}
                  className={`text-[10px] py-1 ${linkUrlError ? 'border-destructive focus:border-destructive' : ''}`}
                />
              </div>
              {linkUrlError && (
                <p className="text-[10px] text-destructive m-0">{linkUrlError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <TbButton
                  className="h-7 text-[10px]"
                  onClick={() => { setShowLinkForm(false); setLinkTitle(''); setLinkUrl(''); setLinkUrlError('') }}
                >
                  Cancel
                </TbButton>
                <TbButton variant="primary" onClick={handleAddLink} disabled={linkSaving} className="h-7 text-[10px] gap-1">
                  <IconCheck size={10} />
                  Add
                </TbButton>
              </div>
            </div>
          )}

          {isSidebar && sidebarAttachments.length > 0 && (
            <div className="border border-border divide-y divide-border">
              {sidebarAttachments.map(r => (
                <SidebarResourceItem
                  key={r.id}
                  resource={r}
                  projectId={projectId}
                  versions={versionsLocal}
                  onUpdated={upsertResource}
                  onDeleted={removeResource}
                  onNavigateVersion={onNavigateVersion}
                  onNavigateTrack={onNavigateTrack}
                />
              ))}
            </div>
          )}

          {/* Files list — drawer / default only */}
          {!isSidebar && files.length > 0 && (
            <div style={{ marginBottom: links.length > 0 ? (isDrawer || isSidebar ? 0 : 16) : 0 }} className={isDrawer || isSidebar ? 'mt-1' : undefined}>
              <SectionHeader>FILES</SectionHeader>
              <div className={isDrawer || isSidebar ? 'mt-1 border border-border divide-y divide-border' : undefined}>
              {files.map((r, i) => (
                <ResourcesFileRow
                  key={r.id}
                  resource={r}
                  projectId={projectId}
                  versions={versionsLocal}
                  isLast={isDrawer || isSidebar ? true : i === files.length - 1}
                  onUpdated={upsertResource}
                  onDeleted={removeResource}
                  variant={isSidebar ? 'sidebar' : isDrawer ? 'drawer' : 'default'}
                  onNavigateVersion={onNavigateVersion}
                  onNavigateTrack={onNavigateTrack}
                />
              ))}
              </div>
            </div>
          )}

          {/* Add link inline form — drawer / default */}
          {showLinkForm && !isSidebar && (
            <div className="border border-lime bg-surface p-3 mb-2 space-y-2">
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

          {/* Links list — drawer / default only */}
          {!isSidebar && links.length > 0 && (
            <div className={isDrawer || isSidebar ? 'mt-2' : undefined}>
              <SectionHeader>LINKS</SectionHeader>
              <div className={isDrawer || isSidebar ? 'mt-1 border border-border divide-y divide-border' : undefined}>
                {links.map((r, i) => (
                  <ResourcesLinkRow
                    key={r.id}
                    resource={r}
                    projectId={projectId}
                    versions={versionsLocal}
                    isLast={i === links.length - 1}
                    onUpdated={upsertResource}
                    onDeleted={removeResource}
                    variant={isSidebar ? 'sidebar' : isDrawer ? 'drawer' : 'default'}
                    onNavigateVersion={onNavigateVersion}
                    onNavigateTrack={onNavigateTrack}
                  />
                ))}
              </div>
            </div>
          )}

          <ResourcesUploadZone
            ref={uploadRef}
            projectId={projectId}
            hideDropZone={hideUploadZone || isSidebar}
            uploadDisabled={storageFull}
            onUploadComplete={r => { upsertResource(r) }}
          />
        </>
      )}
          </div>
        </div>
      </div>
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

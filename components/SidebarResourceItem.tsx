'use client'

import { useState } from 'react'
import { trackEvent } from '@/lib/analytics'
import { useResourceRowExpand } from './useResourceRowExpand'
import type { ProjectResource, Version } from '@/lib/types'
import {
  ResourceContextControls,
  resourceContextDraft,
  type ResourceContextDraft,
} from './ResourceContextControls'
import { ResourceDeleteConfirm } from './ResourceDeleteConfirm'

function IconLink({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-ember">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconDownload({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 9l5 5 5-5M12 4v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPencil({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconExternal({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function displayName(resource: ProjectResource): string {
  if (resource.type === 'link') {
    if (resource.title) return resource.title
    try {
      return new URL(resource.url ?? '').hostname.replace(/^www\./, '')
    } catch {
      return resource.url ?? 'Link'
    }
  }
  return resource.title || resource.original_filename || 'File'
}

function fileKind(resource: ProjectResource): string {
  const ext = resource.original_filename?.match(/\.[^.]+$/)?.[0]?.toUpperCase().replace('.', '') ?? 'FILE'
  return ext.slice(0, 4)
}

export function SidebarResourceItem({
  resource,
  projectId,
  versions = [],
  onUpdated,
  onDeleted,
  onNavigateVersion,
  onNavigateTrack,
}: {
  resource: ProjectResource
  projectId: string
  versions?: Version[]
  onUpdated: (resource: ProjectResource) => void
  onDeleted: (id: string) => void
  onNavigateVersion?: (versionId: string) => void
  onNavigateTrack?: (trackId: string, versionId: string) => void
}) {
  const isLink = resource.type === 'link'
  const name = displayName(resource)

  const [editing, setEditing] = useState(false)
  const { expanded, rowHandlers } = useResourceRowExpand()
  const [nameInput, setNameInput] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [contextDraft, setContextDraft] = useState<ResourceContextDraft>(() => resourceContextDraft(resource))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function startEdit() {
    if (isLink) {
      setLinkTitle(resource.title ?? '')
      setLinkUrl(resource.url ?? '')
    } else {
      setNameInput(resource.title ?? resource.original_filename ?? '')
    }
    setContextDraft(resourceContextDraft(resource))
    setEditing(true)
  }

  function handleDownload() {
    trackEvent('resource_downloaded', { resource_type: 'file' })
    const a = document.createElement('a')
    a.href = `/api/projects/${projectId}/resources/${resource.id}/download`
    a.download = resource.original_filename ?? 'download'
    a.click()
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const body = isLink
        ? { title: linkTitle.trim() || null, url: linkUrl.trim(), ...contextDraft }
        : { title: nameInput.trim(), ...contextDraft }
      const res = await fetch(`/api/projects/${projectId}/resources/${resource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const { resource: updated } = await res.json()
        onUpdated(updated)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/resources/${resource.id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        trackEvent('resource_deleted', { resource_type: resource.type })
        onDeleted(resource.id)
      }
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (confirmDelete) {
    return (
      <div className="px-1.5 py-1 border border-destructive/30 bg-surface/80">
        <ResourceDeleteConfirm
          label={name}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      </div>
    )
  }

  if (editing) {
    return (
      <div className="px-1.5 py-1 flex flex-col gap-1.5 border border-ember/40 bg-surface/50">
        {isLink ? (
          <>
            <input
              type="text"
              placeholder="Title"
              value={linkTitle}
              onChange={e => setLinkTitle(e.target.value)}
              className="w-full bg-surface border border-border px-1.5 py-0.5 text-[10px] outline-none focus:border-ember"
            />
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              className="w-full bg-surface border border-border px-1.5 py-0.5 text-[10px] outline-none focus:border-ember"
            />
          </>
        ) : (
          <input
            autoFocus
            type="text"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            className="w-full bg-surface border border-border px-1.5 py-0.5 text-[10px] outline-none focus:border-ember"
          />
        )}
        <ResourceContextControls
          resource={resource}
          projectId={projectId}
          versions={versions}
          compact
          editing
          draft={contextDraft}
          onDraftChange={setContextDraft}
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={() => setEditing(false)} className="text-[9px] text-muted-foreground bg-transparent border-0 cursor-pointer">Cancel</button>
          <button type="button" onClick={saveEdit} disabled={saving} className="text-[9px] text-ember bg-transparent border-0 cursor-pointer">Save</button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="sidebar-resource-item px-1 py-1 hover:bg-surface/80 transition-colors duration-150 cursor-pointer touch-manipulation"
      data-expanded={expanded ? 'true' : undefined}
      {...rowHandlers}
    >
      <div className="flex items-center gap-1 min-w-0 min-h-[22px]">
        <span className="w-7 shrink-0 flex items-center justify-center">
          {isLink ? (
            <IconLink />
          ) : (
            <span className="text-[10px] font-bold tracking-widest text-ember uppercase">{fileKind(resource)}</span>
          )}
        </span>
        <span className="flex-1 truncate min-w-0 text-xs font-medium text-foreground" title={name}>{name}</span>
        <div className="sidebar-resource-actions flex items-center shrink-0">
          {isLink ? (
            <a
              href={resource.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              title="Open link"
              onClick={e => e.stopPropagation()}
              className="p-0.5 text-muted-foreground hover:text-foreground"
            >
              <IconExternal />
            </a>
          ) : (
            <button type="button" onClick={e => { e.stopPropagation(); handleDownload() }} title="Download" className="p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer">
              <IconDownload />
            </button>
          )}
          <button
            type="button"
            title="Edit"
            onClick={e => { e.stopPropagation(); startEdit() }}
            className="p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer"
          >
            <IconPencil />
          </button>
          <button type="button" onClick={e => { e.stopPropagation(); setConfirmDelete(true) }} title="Delete" className="p-0.5 text-muted-foreground hover:text-destructive bg-transparent border-0 cursor-pointer">
            <IconTrash />
          </button>
        </div>
      </div>
      <div
        className="sidebar-resource-chips-row"
        data-stop-row-expand
        onClick={e => e.stopPropagation()}
      >
        <ResourceContextControls
          resource={resource}
          projectId={projectId}
          versions={versions}
          compact
          onUpdated={onUpdated}
          onNavigateVersion={onNavigateVersion}
          onNavigateTrack={onNavigateTrack}
        />
      </div>
    </div>
  )
}

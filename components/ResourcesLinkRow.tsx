'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectResource } from '@/lib/types'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconLink({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconExternalLink({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPencil({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDisplayTitle(resource: ProjectResource): string {
  if (resource.title) return resource.title
  try {
    return new URL(resource.url ?? '').hostname.replace(/^www\./, '')
  } catch {
    return resource.url ?? 'Untitled link'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  resource: ProjectResource
  projectId: string
  isLast: boolean
  onUpdated: (resource: ProjectResource) => void
  onDeleted: (id: string) => void
  variant?: 'default' | 'drawer'
}

export function ResourcesLinkRow({ resource, projectId, isLast, onUpdated, onDeleted, variant = 'default' }: Props) {
  const [editing, setEditing] = useState(false)
  const [titleInput, setTitleInput] = useState(resource.title ?? '')
  const [urlInput, setUrlInput] = useState(resource.url ?? '')
  const [urlError, setUrlError] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setTitleInput(resource.title ?? '')
    setUrlInput(resource.url ?? '')
    setUrlError('')
    setEditing(true)
  }

  async function saveEdit() {
    setUrlError('')
    if (!urlInput.trim()) { setUrlError('URL is required'); return }
    if (!/^https?:\/\//i.test(urlInput.trim())) { setUrlError('Please enter a valid URL'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/resources/${resource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput.trim() || null, url: urlInput.trim() }),
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
    if (!confirm(`Remove "${getDisplayTitle(resource)}"?`)) return
    const res = await fetch(`/api/projects/${projectId}/resources/${resource.id}`, { method: 'DELETE' })
    if (res.ok || res.status === 204) onDeleted(resource.id)
  }

  const btnStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    height: 26,
    borderRadius: 5,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'color 0.12s',
  }

  if (editing) {
    return (
      <div className={variant === 'drawer' ? 'border border-border p-3 mb-2' : undefined} style={variant === 'drawer' ? undefined : { padding: '8px 0', borderBottom: isLast ? 'none' : '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Title (optional)"
            value={titleInput}
            onChange={e => setTitleInput(e.target.value)}
            style={{
              flex: 1,
              fontSize: 12,
              color: 'var(--text)',
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              borderRadius: 5,
              padding: '4px 8px',
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          />
          <input
            autoFocus
            type="url"
            placeholder="https://…"
            value={urlInput}
            onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit() }}
            style={{
              flex: 2,
              fontSize: 12,
              color: 'var(--text)',
              background: 'var(--bg-card)',
              border: `0.5px solid ${urlError ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 5,
              padding: '4px 8px',
              outline: 'none',
            }}
            onFocus={e => { if (!urlError) e.target.style.borderColor = 'var(--accent)' }}
            onBlur={e => { if (!urlError) e.target.style.borderColor = 'var(--border)' }}
          />
        </div>
        {urlError && <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{urlError}</p>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            onClick={() => setEditing(false)}
            style={{ fontSize: 11, color: 'var(--text-dim)', padding: '3px 10px', borderRadius: 5, border: '0.5px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={saveEdit}
            disabled={saving}
            style={{ fontSize: 11, color: '#fff', padding: '3px 10px', borderRadius: 5, border: 'none', background: 'var(--accent)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <IconCheck size={11} />
            Save
          </button>
        </div>
      </div>
    )
  }

  if (variant === 'drawer') {
    return (
      <div className="border border-border p-3 text-xs flex items-center justify-between gap-3 min-w-0 group hover:bg-surface transition-colors">
        <span className="truncate font-medium text-foreground">{getDisplayTitle(resource)}</span>
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <a
            href={resource.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground truncate max-w-[120px] sm:max-w-[180px] hover:text-ember no-underline"
          >
            {resource.url}
          </a>
          <button type="button" onClick={startEdit} title="Edit" className="text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer p-0.5">
            <IconPencil size={12} />
          </button>
          <button type="button" onClick={handleDelete} title="Delete" className="text-muted-foreground hover:text-destructive bg-transparent border-0 cursor-pointer p-0.5">
            <IconTrash size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        minHeight: 52,
        borderBottom: isLast ? 'none' : '0.5px solid var(--border)',
      }}
    >
      {/* Link icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: 'rgba(99,102,241,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'var(--accent)',
        }}
      >
        <IconLink size={17} />
      </div>

      {/* Center */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getDisplayTitle(resource)}
        </p>
        <a
          href={resource.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11,
            color: 'var(--accent)',
            textDecoration: 'none',
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}
        >
          {resource.url}
        </a>
      </div>

      {/* Actions */}
      <a
        href={resource.url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        title="Open"
        style={{ ...btnStyle, textDecoration: 'none' }}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--accent)')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-dim)')}
      >
        <IconExternalLink size={13} />
      </a>
      <button
        onClick={startEdit}
        title="Edit"
        style={btnStyle}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-muted)')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-dim)')}
      >
        <IconPencil size={13} />
      </button>
      <button
        onClick={handleDelete}
        title="Delete"
        style={btnStyle}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--danger)')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-dim)')}
      >
        <IconTrash size={13} />
      </button>
    </div>
  )
}

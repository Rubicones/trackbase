'use client'

import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ProjectResource } from '@/lib/types'

// ── File type icons (Tabler-style SVGs) ───────────────────────────────────────

function IconFilePdf({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 15v-2h1.5a1 1 0 0 1 0 2H9zM13 13h1a2 2 0 0 1 0 4h-1v-4z" stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconMusic({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18V5l12-2v13" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" stroke={color} strokeWidth="1.4" />
      <circle cx="18" cy="16" r="3" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

function IconZip({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="12" x2="12" y2="12.01" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 13h2v2h-2v2h2" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPhoto({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.4" />
      <circle cx="8.5" cy="8.5" r="1.5" stroke={color} strokeWidth="1.2" />
      <path d="M21 15l-5-5L5 21" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconFileText({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 13h6M9 17h4" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconFile({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconDownload({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 9l5 5 5-5M12 4v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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

// ── File type detection ───────────────────────────────────────────────────────

const DAW_EXTENSIONS = new Set(['.als', '.flp', '.ptx', '.ptf', '.logicx', '.cpr', '.rpp'])

interface IconTheme {
  bg: string
  fg: string
  Icon: (p: { color: string }) => ReactElement
}

function getIconTheme(resource: ProjectResource): IconTheme {
  const mime = resource.mime_type ?? ''
  const ext = resource.original_filename?.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ''

  if (mime === 'application/pdf' || ext === '.pdf') {
    return { bg: 'rgba(248,113,113,0.12)', fg: '#f87171', Icon: IconFilePdf }
  }
  if (DAW_EXTENSIONS.has(ext)) {
    return { bg: 'rgba(167,139,250,0.12)', fg: '#a78bfa', Icon: IconMusic }
  }
  if (mime.includes('zip') || ext === '.zip' || ext === '.rar') {
    return { bg: 'rgba(251,191,36,0.12)', fg: '#fbbf24', Icon: IconZip }
  }
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    return { bg: 'rgba(96,165,250,0.12)', fg: '#60a5fa', Icon: IconPhoto }
  }
  if (['.doc', '.docx', '.txt', '.md'].includes(ext) || mime.includes('text')) {
    return { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8', Icon: IconFileText }
  }
  return { bg: 'rgba(148,163,184,0.10)', fg: '#94a3b8', Icon: IconFile }
}

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}

function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  resource: ProjectResource
  projectId: string
  isLast: boolean
  onUpdated: (resource: ProjectResource) => void
  onDeleted: (id: string) => void
}

export function ResourcesFileRow({ resource, projectId, isLast, onUpdated, onDeleted }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(resource.title ?? resource.original_filename ?? '')
  const [saving, setSaving] = useState(false)

  const { bg, fg, Icon } = getIconTheme(resource)
  const ext = resource.original_filename?.match(/\.[^.]+$/)?.[0]?.toUpperCase().replace('.', '') ?? ''
  const displayName = resource.title || resource.original_filename || 'Untitled'
  const size = fmtSize(resource.file_size_bytes)

  function handleDownload() {
    const a = document.createElement('a')
    a.href = `/api/projects/${projectId}/resources/${resource.id}/download`
    a.download = resource.original_filename ?? 'download'
    a.click()
  }

  async function saveRename() {
    if (!nameInput.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/resources/${resource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nameInput.trim() }),
      })
      if (res.ok) {
        const { resource: updated } = await res.json()
        onUpdated(updated)
        setRenaming(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove "${displayName}"?`)) return
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
      {/* File type icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          background: bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon color={fg} />
      </div>

      {/* Center: name + metadata */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {renaming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              autoFocus
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveRename()
                if (e.key === 'Escape') setRenaming(false)
              }}
              style={{
                flex: 1,
                fontSize: 12,
                color: 'var(--text)',
                background: 'var(--bg-card)',
                border: '0.5px solid var(--accent)',
                borderRadius: 5,
                padding: '3px 7px',
                outline: 'none',
                minWidth: 0,
              }}
            />
            <button onClick={saveRename} disabled={saving} style={{ ...btnStyle, color: 'var(--accent)' }}>
              <IconCheck size={12} />
            </button>
            <button onClick={() => setRenaming(false)} style={{ ...btnStyle, fontSize: 11, color: 'var(--text-dim)' }}>
              ✕
            </button>
          </div>
        ) : (
          <p
            style={{
              fontSize: 13,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 500,
            }}
            title={displayName}
          >
            {displayName}
          </p>
        )}
        {!renaming && (
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[ext, size, resource.author_username && `by ${resource.author_username}`, fmtRelative(resource.created_at)]
              .filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {/* Actions */}
      <button
        onClick={handleDownload}
        title="Download"
        style={btnStyle}
        onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text)')}
        onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = 'var(--text-dim)')}
      >
        <IconDownload size={14} />
      </button>
      <button
        onClick={() => { setNameInput(resource.title ?? resource.original_filename ?? ''); setRenaming(true) }}
        title="Rename"
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

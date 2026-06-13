'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { ProjectResource } from '@/lib/types'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconMic({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="21" x2="12" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="21" x2="15" y2="21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconX({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
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

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

function lineCount(text: string): number {
  return text ? text.split('\n').length : 0
}

// ── Lyrics Editor Modal ───────────────────────────────────────────────────────

interface EditorProps {
  projectId: string
  projectName: string
  initialContent: string
  onSaved: (resource: ProjectResource) => void
  onClose: () => void
}

function LyricsEditorModal({ projectId, projectName, initialContent, onSaved, onClose }: EditorProps) {
  const [text, setText] = useState(initialContent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/projects/${projectId}/resources/lyrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({}))
        throw new Error(msg ?? 'Save failed')
      }
      const { resource } = await res.json()
      onSaved(resource)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const wc = wordCount(text)
  const lc = lineCount(text)

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 8000,
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 8001,
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border-light)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: '0.5px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconMic size={16} color="var(--accent)" />
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
              Lyrics — {projectName}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: 'pointer',
            }}
          >
            <IconX size={15} />
          </button>
        </div>

        {/* Textarea */}
        <div style={{ flex: 1, overflow: 'hidden', padding: 16, display: 'flex', flexDirection: 'column' }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Verse 1\n...\n\nChorus\n...'}
            style={{
              flex: 1,
              width: '100%',
              minHeight: 360,
              maxHeight: 'calc(100vh - 260px)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text)',
              background: 'var(--bg)',
              border: '0.5px solid var(--border)',
              borderRadius: 8,
              padding: 16,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)' }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderTop: '0.5px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <p style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {wc} word{wc !== 1 ? 's' : ''} · {lc} line{lc !== 1 ? 's' : ''}
          </p>
          {error && <p style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                padding: '5px 14px',
                borderRadius: 6,
                border: '0.5px solid var(--border)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                fontSize: 12,
                color: '#fff',
                padding: '5px 14px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent)',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ── Lyrics Display ────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  projectName: string
  lyrics: ProjectResource | null
  onUpdate: (resource: ProjectResource) => void
  /** In drawer mode, show full lyrics without truncation */
  showFullByDefault?: boolean
  /** Open the editor modal immediately on mount */
  autoOpen?: boolean
  /** Sidebar: button-only row */
  compact?: boolean
}

const PREVIEW_LINES = 4

export function ResourcesLyrics({ projectId, projectName, lyrics, onUpdate, showFullByDefault = false, autoOpen = false, compact = false }: Props) {
  const [expanded, setExpanded] = useState(showFullByDefault)
  const [editorOpen, setEditorOpen] = useState(autoOpen)

  const content = lyrics?.content ?? ''

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="w-full flex items-center gap-2 rounded-lg mb-1 transition-colors duration-150 text-[13px]"
          style={{ padding: '8px 10px', color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.color = 'var(--text-sec)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <IconMic size={13} color="var(--accent)" />
          {lyrics?.content?.trim() ? 'Open lyrics' : 'Add lyrics'}
        </button>
        {editorOpen && (
          <LyricsEditorModal
            projectId={projectId}
            projectName={projectName}
            initialContent={content}
            onSaved={onUpdate}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </>
    )
  }

  const lines = content.split('\n')
  const needsTruncation = !showFullByDefault && lines.length > PREVIEW_LINES

  const displayLines = expanded || showFullByDefault ? lines : lines.slice(0, PREVIEW_LINES)
  const displayText = displayLines.join('\n')

  // No lyrics yet
  if (!lyrics) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconMic size={14} color="var(--text-dim)" />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No lyrics added</span>
          <button
            onClick={() => setEditorOpen(true)}
            style={{
              fontSize: 12,
              color: 'var(--accent)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              marginLeft: 4,
            }}
          >
            + Add lyrics
          </button>
        </div>

        {editorOpen && (
          <LyricsEditorModal
            projectId={projectId}
            projectName={projectName}
            initialContent=""
            onSaved={onUpdate}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <IconMic size={15} color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>Lyrics</span>
        <button
          onClick={() => setEditorOpen(true)}
          style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Edit
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Last edited {fmtRelative(lyrics.updated_at)}
        </span>
      </div>

      {/* Content preview */}
      <div style={{ position: 'relative' }}>
        <pre
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-sec)',
            margin: 0,
            fontFamily: 'inherit',
          }}
        >
          {displayText}
        </pre>

        {/* Fade-out gradient when truncated */}
        {needsTruncation && !expanded && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 28,
              background: 'linear-gradient(to bottom, transparent, var(--bg-surface))',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* Show more / Show less */}
      {needsTruncation && (
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            fontSize: 12,
            color: 'var(--accent)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginTop: 4,
            display: 'block',
          }}
        >
          {expanded ? 'Show less' : `Show more (${lines.length - PREVIEW_LINES} more lines)`}
        </button>
      )}

      {editorOpen && (
        <LyricsEditorModal
          projectId={projectId}
          projectName={projectName}
          initialContent={content}
          onSaved={onUpdate}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  )
}

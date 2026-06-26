'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '@/lib/analytics'
import type { ProjectResource } from '@/lib/types'
import { TbButton } from '@/components/design/TbButton'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconMic({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="21" x2="12" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="21" x2="15" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
    trackEvent('lyrics_editor_opened')
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
      trackEvent('lyrics_saved')
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
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[640px] max-h-[calc(100vh-64px)] flex flex-col border border-border bg-popover shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <IconMic size={16} className="text-ember shrink-0" />
            <span className="font-display text-sm uppercase tracking-tight text-foreground truncate">
              Lyrics — {projectName}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="size-8 border border-border grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition-colors shrink-0"
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Verse 1\n...\n\nChorus\n...'}
            className="flex-1 w-full min-h-[360px] max-h-[calc(100vh-260px)] font-mono text-sm leading-relaxed text-foreground bg-background border border-border p-4 resize-y outline-none focus:border-ember placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border shrink-0">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground m-0">
            {wc} word{wc !== 1 ? 's' : ''} · {lc} line{lc !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            {error && <p className="text-[11px] text-destructive m-0">{error}</p>}
            <TbButton onClick={onClose}>Cancel</TbButton>
            <TbButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </TbButton>
          </div>
        </div>
      </div>
    </div>,
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
  variant?: 'default' | 'drawer'
}

const PREVIEW_LINES = 4

export function ResourcesLyrics({ projectId, projectName, lyrics, onUpdate, showFullByDefault = false, autoOpen = false, compact = false, variant = 'default' }: Props) {
  const isDrawer = variant === 'drawer'
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
          <IconMic size={13} className="text-ember" />
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
        <div className="flex items-center gap-2 flex-wrap">
          <IconMic size={14} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">No lyrics added</span>
          <TbButton className="ml-1" onClick={() => setEditorOpen(true)}>
            Add lyrics
          </TbButton>
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
      {!isDrawer && (
        <div className="flex items-center gap-2 mb-2">
          <IconMic size={15} className="text-ember shrink-0" />
          <span className="text-sm font-medium text-foreground flex-1">Lyrics</span>
          <TbButton onClick={() => setEditorOpen(true)}>Edit</TbButton>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Last edited {fmtRelative(lyrics.updated_at)}
          </span>
        </div>
      )}

      {/* Content preview */}
      <div style={{ position: 'relative' }} className={isDrawer ? 'mt-2' : undefined}>
        <pre
          className={isDrawer ? 'text-xs whitespace-pre-wrap text-muted-foreground bg-surface border border-border p-3 max-h-40 overflow-auto m-0 leading-relaxed' : undefined}
          style={isDrawer ? undefined : {
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

      {isDrawer && (
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="mt-2 text-[10px] uppercase tracking-widest text-ember hover:underline bg-transparent border-0 cursor-pointer p-0"
        >
          Edit lyrics →
        </button>
      )}

      {/* Show more / Show less */}
      {needsTruncation && !isDrawer && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[10px] uppercase tracking-widest text-ember hover:underline bg-transparent border-0 cursor-pointer p-0"
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

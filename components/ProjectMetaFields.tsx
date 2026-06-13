'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@/lib/types'

export function ProjectMetaFields({
  projectId,
  bpm,
  keySig,
  onUpdated,
  variant = 'inline',
}: {
  projectId: string
  bpm: number | null
  keySig: string | null
  onUpdated: (patch: Pick<Project, 'bpm' | 'key'>) => void
  /** inline — click-to-edit on card; menu — always-visible fields for dropdown */
  variant?: 'inline' | 'menu'
}) {
  const [editingBpm, setEditingBpm] = useState(false)
  const [editingKey, setEditingKey] = useState(false)
  const [bpmVal, setBpmVal] = useState(bpm?.toString() ?? '')
  const [keyVal, setKeyVal] = useState(keySig ?? '')
  const bpmRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editingBpm) setBpmVal(bpm?.toString() ?? '')
  }, [bpm, editingBpm])

  useEffect(() => {
    if (!editingKey) setKeyVal(keySig ?? '')
  }, [keySig, editingKey])

  const saveMeta = useCallback(async (patch: { bpm?: number | null; key?: string | null }) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return
      const { project } = await res.json()
      onUpdated({ bpm: project.bpm, key: project.key })
    } catch {
      // ignore
    }
  }, [projectId, onUpdated])

  async function commitBpm() {
    setEditingBpm(false)
    const trimmed = bpmVal.trim()
    if (!trimmed) {
      if (bpm != null) await saveMeta({ bpm: null })
      return
    }
    const n = parseInt(trimmed, 10)
    if (!Number.isFinite(n) || n < 40 || n > 300) {
      setBpmVal(bpm?.toString() ?? '')
      return
    }
    if (n !== bpm) await saveMeta({ bpm: n })
  }

  async function commitKey() {
    setEditingKey(false)
    const trimmed = keyVal.trim()
    const next = trimmed || null
    if (next !== (keySig || null)) await saveMeta({ key: next })
  }

  const fieldBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontSize: 11,
    color: 'var(--text-dim)',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-soft)',
    background: 'var(--bg-card)',
    border: '0.5px solid var(--border)',
    borderRadius: 6,
    padding: '6px 8px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  if (variant === 'menu') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>BPM</span>
          <input
            ref={bpmRef}
            value={bpmVal}
            onChange={e => setBpmVal(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={e => { if (e.key === 'Enter') void commitBpm() }}
            onBlur={() => void commitBpm()}
            placeholder="120"
            type="text"
            inputMode="numeric"
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key</span>
          <input
            ref={keyRef}
            value={keyVal}
            onChange={e => setKeyVal(e.target.value.slice(0, 40))}
            onKeyDown={e => { if (e.key === 'Enter') void commitKey() }}
            onBlur={() => void commitKey()}
            placeholder="C minor"
            style={inputStyle}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
          />
        </label>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={fieldBtn}>
        BPM{' '}
        {editingBpm ? (
          <input
            ref={bpmRef}
            value={bpmVal}
            onChange={e => setBpmVal(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={e => {
              if (e.key === 'Enter') void commitBpm()
              if (e.key === 'Escape') { setEditingBpm(false); setBpmVal(bpm?.toString() ?? '') }
            }}
            onBlur={() => void commitBpm()}
            type="text"
            inputMode="numeric"
            style={{
              width: 42, fontSize: 11, fontWeight: 500, color: 'var(--text-soft)',
              background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
              borderRadius: 4, padding: '1px 4px', outline: 'none',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditingBpm(true); setTimeout(() => bpmRef.current?.select(), 0) }}
            style={{
              ...fieldBtn,
              fontWeight: 500,
              color: bpm ? 'var(--text-soft)' : 'var(--text-dim)',
              fontStyle: bpm ? 'normal' : 'italic',
            }}
          >
            {bpm ?? 'set'}
          </button>
        )}
      </span>
      <span style={fieldBtn}>
        Key{' '}
        {editingKey ? (
          <input
            ref={keyRef}
            value={keyVal}
            onChange={e => setKeyVal(e.target.value.slice(0, 40))}
            onKeyDown={e => {
              if (e.key === 'Enter') void commitKey()
              if (e.key === 'Escape') { setEditingKey(false); setKeyVal(keySig ?? '') }
            }}
            onBlur={() => void commitKey()}
            placeholder="C minor"
            style={{
              width: 72, fontSize: 11, fontWeight: 500, color: 'var(--text-soft)',
              background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
              borderRadius: 4, padding: '1px 4px', outline: 'none',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditingKey(true); setTimeout(() => keyRef.current?.select(), 0) }}
            style={{
              ...fieldBtn,
              fontWeight: 500,
              color: keySig ? 'var(--text-soft)' : 'var(--text-dim)',
              fontStyle: keySig ? 'normal' : 'italic',
            }}
          >
            {keySig ?? 'set'}
          </button>
        )}
      </span>
    </div>
  )
}

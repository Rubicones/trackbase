'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@/lib/types'

const menuInputCls =
  'w-full bg-surface border border-border px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ember'

const inlineInputCls =
  'bg-surface border border-ember px-1.5 py-0.5 text-xs font-mono text-foreground outline-none focus:border-ember tabular-nums'

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

  if (variant === 'menu') {
    return (
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">BPM</span>
          <input
            ref={bpmRef}
            value={bpmVal}
            onChange={e => setBpmVal(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={e => { if (e.key === 'Enter') void commitBpm() }}
            onBlur={() => void commitBpm()}
            placeholder="120"
            type="text"
            inputMode="numeric"
            className={menuInputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Key</span>
          <input
            ref={keyRef}
            value={keyVal}
            onChange={e => setKeyVal(e.target.value.slice(0, 40))}
            onKeyDown={e => { if (e.key === 'Enter') void commitKey() }}
            onBlur={() => void commitKey()}
            placeholder="C minor"
            className={menuInputCls}
          />
        </label>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4 flex-wrap text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1.5">
        BPM
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
            className={`${inlineInputCls} w-10`}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditingBpm(true); setTimeout(() => bpmRef.current?.select(), 0) }}
            className={`font-mono normal-case tracking-normal ${
              bpm ? 'text-ember' : 'text-muted-foreground/70 italic'
            }`}
          >
            {bpm ?? 'set'}
          </button>
        )}
      </span>
      <span className="inline-flex items-center gap-1.5">
        Key
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
            className={`${inlineInputCls} w-[4.5rem]`}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditingKey(true); setTimeout(() => keyRef.current?.select(), 0) }}
            className={`font-mono normal-case tracking-normal ${
              keySig ? 'text-foreground' : 'text-muted-foreground/70 italic'
            }`}
          >
            {keySig ?? 'set'}
          </button>
        )}
      </span>
    </div>
  )
}

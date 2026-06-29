'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_TIME_SIGNATURES } from '@/lib/metronomeAudio'
import type { Project } from '@/lib/types'

const menuInputCls =
  'w-full bg-surface border border-border px-2 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-lime'

const inlineInputCls =
  'bg-surface border border-lime px-1.5 py-0.5 text-xs font-mono text-foreground outline-none focus:border-lime tabular-nums'

const inlineSelectCls =
  'bg-surface border border-lime px-1 py-0.5 text-xs font-mono text-foreground outline-none focus:border-lime tabular-nums cursor-pointer'

type MetaPatch = Pick<Project, 'bpm' | 'key' | 'time_signature'>

export function ProjectMetaFields({
  projectId,
  bpm,
  keySig,
  timeSig,
  onUpdated,
  variant = 'inline',
}: {
  projectId: string
  bpm: number | null
  keySig: string | null
  timeSig: string | null
  onUpdated: (patch: MetaPatch) => void
  /** inline — click-to-edit on card; menu — always-visible fields for dropdown; header — project page meta row */
  variant?: 'inline' | 'menu' | 'header'
}) {
  const [editingBpm, setEditingBpm] = useState(false)
  const [editingKey, setEditingKey] = useState(false)
  const [editingTimeSig, setEditingTimeSig] = useState(false)
  const [bpmVal, setBpmVal] = useState(bpm?.toString() ?? '')
  const [keyVal, setKeyVal] = useState(keySig ?? '')
  const [timeSigVal, setTimeSigVal] = useState(timeSig ?? '4/4')
  const bpmRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const timeSigRef = useRef<HTMLSelectElement>(null)

  const displayTimeSig = timeSig ?? '4/4'

  useEffect(() => {
    if (!editingBpm) setBpmVal(bpm?.toString() ?? '')
  }, [bpm, editingBpm])

  useEffect(() => {
    if (!editingKey) setKeyVal(keySig ?? '')
  }, [keySig, editingKey])

  useEffect(() => {
    if (!editingTimeSig) setTimeSigVal(displayTimeSig)
  }, [displayTimeSig, editingTimeSig])

  const saveMeta = useCallback(async (patch: Partial<MetaPatch>) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return
      const { project } = await res.json()
      onUpdated({
        bpm: project.bpm,
        key: project.key,
        time_signature: project.time_signature,
      })
    } catch {
      // ignore
    }
  }, [projectId, onUpdated])

  useEffect(() => {
    if (editingBpm) bpmRef.current?.focus()
  }, [editingBpm])

  useEffect(() => {
    if (editingKey) keyRef.current?.focus()
  }, [editingKey])

  useEffect(() => {
    if (editingTimeSig) timeSigRef.current?.focus()
  }, [editingTimeSig])

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

  async function commitTimeSig() {
    setEditingTimeSig(false)
    if (timeSigVal === displayTimeSig) return
    await saveMeta({ time_signature: timeSigVal })
  }

  const timeSigControl = editingTimeSig ? (
    <select
      ref={timeSigRef}
      value={timeSigVal}
      onChange={e => setTimeSigVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') void commitTimeSig()
        if (e.key === 'Escape') {
          setEditingTimeSig(false)
          setTimeSigVal(displayTimeSig)
        }
      }}
      onBlur={() => void commitTimeSig()}
      className={variant === 'menu' ? menuInputCls : inlineSelectCls}
    >
      {PROJECT_TIME_SIGNATURES.map(ts => (
        <option key={ts} value={ts}>{ts}</option>
      ))}
    </select>
  ) : (
    <button
      type="button"
      onClick={() => {
        setEditingTimeSig(true)
        setTimeout(() => timeSigRef.current?.focus(), 0)
      }}
      className={
        variant === 'header'
          ? 'text-[10px] uppercase tracking-widest tabular-nums hover:text-lime transition-colors text-lime'
          : variant === 'menu'
            ? 'font-mono normal-case tracking-normal text-lime text-left'
            : 'font-mono normal-case tracking-normal text-lime'
      }
    >
      {displayTimeSig}
    </button>
  )

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
        <label className="flex flex-col gap-1">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Time</span>
          <select
            value={timeSigVal}
            onChange={e => {
              const next = e.target.value
              setTimeSigVal(next)
              if (next !== displayTimeSig) void saveMeta({ time_signature: next })
            }}
            className={menuInputCls}
          >
            {PROJECT_TIME_SIGNATURES.map(ts => (
              <option key={ts} value={ts}>{ts}</option>
            ))}
          </select>
        </label>
      </div>
    )
  }

  if (variant === 'header') {
    return (
      <>
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
            className={`text-[10px] uppercase tracking-widest tabular-nums hover:text-lime transition-colors ${
              bpm != null ? 'text-lime' : 'text-muted-foreground italic normal-case'
            }`}
          >
            {bpm != null ? `${bpm} BPM` : 'Set BPM'}
          </button>
        )}
        {timeSigControl}
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
            placeholder="C"
            className={`${inlineInputCls} w-[4.5rem]`}
          />
        ) : (
          <button
            type="button"
            onClick={() => { setEditingKey(true); setTimeout(() => keyRef.current?.select(), 0) }}
            className={`text-[10px] uppercase tracking-widest tabular-nums hover:text-lime transition-colors ${
              keySig ? 'text-lime' : 'text-muted-foreground italic normal-case'
            }`}
          >
            {keySig ?? 'Set key'}
          </button>
        )}
      </>
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
              bpm ? 'text-lime' : 'text-muted-foreground/70 italic'
            }`}
          >
            {bpm ?? 'set'}
          </button>
        )}
      </span>
      <span className="inline-flex items-center gap-1.5">
        Time
        {timeSigControl}
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

'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Project, Section, SectionType } from '@/lib/types'

// ─── Section colors ───────────────────────────────────────────────────────────

export const SECTION_COLORS: Record<SectionType, { bg: string; fg: string }> = {
  intro:        { bg: 'rgba(99,102,241,0.38)',  fg: '#6366F1' },
  verse:        { bg: 'rgba(16,185,129,0.38)',  fg: '#10B981' },
  chorus:       { bg: 'rgba(168,85,247,0.38)',  fg: '#A855F7' },
  'pre-chorus': { bg: 'rgba(245,158,11,0.38)',  fg: '#F59E0B' },
  bridge:       { bg: 'rgba(6,182,212,0.38)',   fg: '#06B6D4' },
  drop:         { bg: 'rgba(239,68,68,0.38)',   fg: '#ef4444' },
  breakdown:    { bg: 'rgba(107,114,128,0.38)', fg: '#6b7280' },
  outro:        { bg: 'rgba(59,130,246,0.38)',  fg: '#3b82f6' },
  custom:       { bg: 'rgba(156,163,175,0.38)', fg: '#9ca3af' },
}

const SECTION_TYPES: SectionType[] = [
  'intro', 'verse', 'chorus', 'pre-chorus', 'bridge', 'drop', 'breakdown', 'outro', 'custom',
]

const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  intro: 'Intro', verse: 'Verse', chorus: 'Chorus',
  'pre-chorus': 'Pre-Ch.', bridge: 'Bridge', drop: 'Drop',
  breakdown: 'Breakdown', outro: 'Outro', custom: 'Custom…',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sectionLabel(s: Section): string {
  return s.custom_name ?? (s.type.charAt(0).toUpperCase() + s.type.slice(1))
}

export function getBarMath(project: Project, totalDurationMs: number) {
  const beatsPerBar = parseInt((project.time_signature ?? '4/4').split('/')[0]) || 4
  const barDurationMs = project.bpm
    ? (60 / project.bpm) * beatsPerBar * 1000
    : 4000
  const totalBars = barDurationMs > 0
    ? Math.max(1, Math.ceil(totalDurationMs / barDurationMs))
    : 1
  return { beatsPerBar, barDurationMs, totalBars }
}

// ─── Name picker portal (new section placement) ───────────────────────────────

function NamePickerPortal({
  selectionStart, selectionEnd, barDurationMs, totalDurationMs, stripRef,
  onConfirm, onCancel,
}: {
  selectionStart: number
  selectionEnd: number
  barDurationMs: number
  totalDurationMs: number
  stripRef: React.RefObject<HTMLDivElement | null>
  onConfirm: (type: SectionType, customName?: string) => void
  onCancel: () => void
}) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')

  useEffect(() => { if (customMode) customInputRef.current?.focus() }, [customMode])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) onCancel()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onCancel])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const W = 258
  const POPOVER_H = 180
  let pLeft = 8, pTop = 200, caret = W / 2, flippedPicker = false

  if (typeof window !== 'undefined' && stripRef.current) {
    const rect = stripRef.current.getBoundingClientRect()
    const midMs = ((selectionStart + selectionEnd) / 2) * barDurationMs
    const cx = rect.left + (totalDurationMs > 0 ? midMs / totalDurationMs : 0.5) * rect.width
    pLeft = Math.max(8, Math.min(cx - W / 2, window.innerWidth - W - 8))
    caret = Math.max(12, Math.min(W - 12, cx - pLeft))
    if (rect.top < POPOVER_H + 8) {
      pTop = rect.bottom + 8
      flippedPicker = true
    } else {
      pTop = rect.top - 8
    }
  }

  return createPortal(
    <div ref={pickerRef} style={{
      position: 'fixed', top: pTop, left: pLeft, width: W,
      transform: flippedPicker ? 'none' : 'translateY(-100%)',
      background: 'var(--bg-surface)', border: '0.5px solid var(--accent)',
      borderRadius: 8, padding: '10px 10px 12px',
      zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    }}>
      {flippedPicker ? (
        <div style={{
          position: 'absolute', top: -5, left: caret - 5,
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderBottom: '5px solid var(--bg-surface)', pointerEvents: 'none',
        }} />
      ) : (
        <div style={{
          position: 'absolute', bottom: -5, left: caret - 5,
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderTop: '5px solid var(--bg-surface)', pointerEvents: 'none',
        }} />
      )}
      <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 8, fontWeight: 500 }}>
        Bars {selectionStart + 1}–{selectionEnd}
      </div>
      {!customMode ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
          {SECTION_TYPES.map(type => {
            const c = SECTION_COLORS[type]
            return (
              <button key={type}
                onClick={() => type === 'custom' ? setCustomMode(true) : onConfirm(type)}
                style={{
                  padding: '5px 6px', borderRadius: 5, fontSize: 10, fontWeight: 500,
                  background: c.bg, color: c.fg, border: `0.5px solid ${c.fg}`,
                  cursor: 'pointer', textAlign: 'center', transition: 'opacity 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              >{SECTION_TYPE_LABELS[type]}</button>
            )
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input ref={customInputRef} value={customName}
            onChange={e => setCustomName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && customName.trim()) onConfirm('custom', customName.trim())
              if (e.key === 'Escape') setCustomMode(false)
            }}
            placeholder="Name this section…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
              borderRadius: 5, padding: '5px 8px', fontSize: 12,
              color: 'var(--text)', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setCustomMode(false)} style={{
              flex: 1, padding: '4px 8px', borderRadius: 5, fontSize: 11,
              background: 'transparent', border: '0.5px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}>Back</button>
            <button
              onClick={() => { if (customName.trim()) onConfirm('custom', customName.trim()) }}
              disabled={!customName.trim()}
              style={{
                flex: 1, padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                background: 'var(--accent)', border: 'none', color: 'white', cursor: 'pointer',
                opacity: customName.trim() ? 1 : 0.4,
              }}
            >Confirm</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// ─── Section edit popover ─────────────────────────────────────────────────────

type CellPos = { left: number; top: number; width: number; height: number }

function SectionEditPopover({
  section, cellPos,
  onTypeChange, onChordsLocalChange, onChordsAutoSave, onDelete, onClose,
}: {
  section: Section
  cellPos: CellPos
  onTypeChange: (id: string, type: SectionType, customName?: string) => void
  onChordsLocalChange: (id: string, chords: string) => void
  onChordsAutoSave: (id: string, chords: string) => Promise<void>
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState(section.custom_name ?? '')
  const [chords, setChords] = useState(section.chords ?? '')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    setChords(section.chords ?? '')
    setSaveStatus('idle')
    setIsDirty(false)
  }, [section.id])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  function handleChordsChange(val: string) {
    setChords(val)
    setIsDirty(true)
    onChordsLocalChange(section.id, val)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await onChordsAutoSave(section.id, val)
        setIsDirty(false)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1500)
      } catch {
        setSaveStatus('error')
      }
    }, 800)
  }

  useEffect(() => { if (customMode) customInputRef.current?.focus() }, [customMode])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const W = 246
  const POPOVER_H = 280
  const cellCx = cellPos.left + cellPos.width / 2
  const pLeft = typeof window !== 'undefined'
    ? Math.max(8, Math.min(cellCx - W / 2, window.innerWidth - W - 8))
    : 8
  const caret = Math.max(12, Math.min(W - 12, cellCx - pLeft))
  const flippedEdit = cellPos.top < POPOVER_H + 8
  const pTop = flippedEdit ? cellPos.top + cellPos.height + 8 : cellPos.top - 8

  function handleTypeClick(type: SectionType) {
    if (type === 'custom') { setCustomMode(true); return }
    onTypeChange(section.id, type)
  }

  function handleCustomConfirm() {
    if (!customName.trim()) return
    onTypeChange(section.id, 'custom', customName.trim())
    setCustomMode(false)
  }

  const textareaBorderColor = isDirty && saveStatus === 'idle' ? '#F59E0B' : 'var(--border)'

  return createPortal(
    <div ref={popoverRef} style={{
      position: 'fixed', top: pTop, left: pLeft, width: W,
      transform: flippedEdit ? 'none' : 'translateY(-100%)',
      background: 'var(--bg-surface)', border: '0.5px solid var(--accent)',
      borderRadius: 8, padding: '10px 10px 10px',
      zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    }}>
      {/* caret */}
      {flippedEdit ? (
        <div style={{
          position: 'absolute', top: -5, left: caret - 5,
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderBottom: '5px solid var(--bg-surface)', pointerEvents: 'none',
        }} />
      ) : (
        <div style={{
          position: 'absolute', bottom: -5, left: caret - 5,
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderTop: '5px solid var(--bg-surface)', pointerEvents: 'none',
        }} />
      )}

      {/* bar range */}
      <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 8, fontWeight: 500 }}>
        Bars {section.start_bar + 1}–{section.end_bar}
      </div>

      {!customMode ? (
        <>
          {/* type grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginBottom: 8 }}>
            {SECTION_TYPES.map(type => {
              const c = SECTION_COLORS[type]
              const active = section.type === type
              return (
                <button key={type} onClick={() => handleTypeClick(type)} style={{
                  padding: '5px 6px', borderRadius: 5, fontSize: 10, fontWeight: 500,
                  background: c.bg, color: c.fg,
                  border: active ? `1.5px solid ${c.fg}` : `0.5px solid ${c.fg}`,
                  cursor: 'pointer', textAlign: 'center', transition: 'opacity 0.12s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                >
                  {type === 'custom' && section.type === 'custom'
                    ? sectionLabel(section)
                    : SECTION_TYPE_LABELS[type]}
                </button>
              )
            })}
          </div>

          {/* chord textarea with autosave indicator */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500 }}>Chords</span>
              {isDirty && saveStatus === 'idle' && (
                <span style={{ fontSize: 9, color: '#F59E0B' }}>Unsaved</span>
              )}
              {saveStatus === 'saving' && (
                <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>Saving…</span>
              )}
              {saveStatus === 'saved' && (
                <span style={{ fontSize: 9, color: '#10B981' }}>● Saved</span>
              )}
              {saveStatus === 'error' && (
                <span style={{ fontSize: 9, color: '#ef4444' }}>Error</span>
              )}
            </div>
            <textarea
              value={chords} rows={2}
              onChange={e => handleChordsChange(e.target.value)}
              placeholder="Am F C G…"
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none',
                background: 'var(--bg-card)',
                border: `0.5px solid ${textareaBorderColor}`,
                borderRadius: 5, padding: '5px 8px',
                fontSize: 11, fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-sec)', outline: 'none',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.currentTarget.style.borderColor = textareaBorderColor }}
            />
          </div>

          {/* delete */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => onDelete(section.id)}
              style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11,
                background: 'transparent', border: '0.5px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.12s',
              }}
              onMouseEnter={e => {
                const t = e.currentTarget
                t.style.background = 'rgba(239,68,68,0.08)'
                t.style.borderColor = '#ef4444'
                t.style.color = '#ef4444'
              }}
              onMouseLeave={e => {
                const t = e.currentTarget
                t.style.background = 'transparent'
                t.style.borderColor = 'var(--border)'
                t.style.color = 'var(--text-muted)'
              }}
            >Delete section</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input ref={customInputRef} value={customName}
            onChange={e => setCustomName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCustomConfirm()
              if (e.key === 'Escape') setCustomMode(false)
            }}
            placeholder="Section name…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-card)', border: '0.5px solid var(--accent)',
              borderRadius: 5, padding: '5px 8px', fontSize: 12,
              color: 'var(--text)', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setCustomMode(false)} style={{
              flex: 1, padding: '4px 8px', borderRadius: 5, fontSize: 11,
              background: 'transparent', border: '0.5px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}>Back</button>
            <button onClick={handleCustomConfirm} disabled={!customName.trim()} style={{
              flex: 1, padding: '4px 8px', borderRadius: 5, fontSize: 11, fontWeight: 500,
              background: 'var(--accent)', border: 'none', color: 'white', cursor: 'pointer',
              opacity: customName.trim() ? 1 : 0.4,
            }}>Save</button>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

// ─── Structure transport (play / time / volume) ───────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M10 4l4 4M14 4l-4 4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
  if (volume < 0.5) return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M10 5.5a1.5 1.5 0 0 1 0 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 5h2l3-3v10L4 9H2V5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M10 4.5a3 3 0 0 1 0 5" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

function StructureTransport({
  side, playing, currentTime, duration, loaded, totalTracks,
  volume, onPlay, onPause, onVolume,
}: {
  side: 'left' | 'right'
  playing: boolean; currentTime: number; duration: number
  loaded: number; totalTracks: number; volume: number
  onPlay: () => void; onPause: () => void; onVolume: (v: number) => void
}) {
  const [showVolume, setShowVolume] = useState(false)
  const [prevVolume, setPrevVolume] = useState(1)
  const volRef = useRef<HTMLDivElement>(null)
  const isLoading = loaded < totalTracks && totalTracks > 0

  useEffect(() => {
    if (!showVolume) return
    function handler(e: MouseEvent) {
      if (volRef.current && !volRef.current.contains(e.target as Node)) setShowVolume(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showVolume])

  function toggleMute() {
    if (volume > 0) { setPrevVolume(volume); onVolume(0) }
    else onVolume(prevVolume || 1)
  }

  if (side === 'left') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 8, paddingRight: 10, width: '100%',
      }}>
        <button onClick={playing ? onPause : onPlay} disabled={totalTracks === 0} className="btn-play">
          {isLoading ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.25" />
              <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><rect x="2" y="2" width="3.5" height="10" rx="1" /><rect x="8.5" y="2" width="3.5" height="10" rx="1" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="white"><path d="M3.5 2l8 5-8 5V2z" /></svg>
          )}
        </button>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-sec)', minWidth: 36 }}>
          {fmtTime(currentTime)}
        </span>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4, width: '100%',
    }}>
      <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', minWidth: 36 }}>
        {fmtTime(duration)}
      </span>
      <div ref={volRef} style={{ position: 'relative' }}>
        <button
          onClick={toggleMute}
          onDoubleClick={() => setShowVolume(v => !v)}
          className="text-dim hover:text-muted transition-colors duration-150 p-1"
          title="Click to mute · Double-click for slider"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', display: 'flex' }}
        >
          <VolumeIcon volume={volume} />
        </button>
        {showVolume && (
          <div style={{
            position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
            background: 'var(--bg-card)', border: '0.5px solid var(--border)',
            borderRadius: 10, padding: '10px 8px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 30,
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {Math.round(volume * 100)}%
            </span>
            <input
              type="range" min={0} max={1} step={0.01} value={volume}
              onChange={e => onVolume(parseFloat(e.target.value))}
              style={{
                writingMode: 'vertical-lr', direction: 'rtl',
                height: 80, width: 20, cursor: 'pointer', accentColor: 'var(--accent)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Structure overlay ────────────────────────────────────────────────────────

type SelMode = 'idle' | 'start_set' | 'naming'
type ActiveEdit = { sectionId: string; cellPos: CellPos }
type ResizeDrag = {
  sectionId: string
  edge: 'start' | 'end'
  origStart: number
  origEnd: number
  minStart: number
  maxStart: number
  minEnd: number
  maxEnd: number
}

export default function StructureOverlay({
  project, versionId, totalDurationMs,
  sections, onSectionsChange,
  editMode, onEditModeChange,
  waveformBounds, currentTimeMs = 0,
  playing, currentTime, duration, loaded, totalTracks,
  volume, onPlay, onPause, onSeek, onVolume,
}: {
  project: Project
  versionId: string
  totalDurationMs: number
  sections: Section[]
  onSectionsChange: (ss: Section[]) => void
  editMode: boolean
  onEditModeChange: (v: boolean) => void
  waveformBounds: { left: number; right: number } | null
  currentTimeMs?: number
  playing: boolean
  currentTime: number
  duration: number
  loaded: number
  totalTracks: number
  volume: number
  onPlay: () => void
  onPause: () => void
  onSeek: (t: number) => void
  onVolume: (v: number) => void
}) {
  const [timeSignature, setTimeSignature] = useState(project.time_signature ?? '4/4')
  const [selMode, setSelMode] = useState<SelMode>('idle')
  const [selStart, setSelStart] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const [hint, setHint] = useState<{ text: string; isError: boolean } | null>(null)
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null)

  const stripRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef(sections)
  const activeEditRef = useRef(activeEdit)
  const resizeDragRef = useRef<ResizeDrag | null>(null)
  const pendingChordSavesRef = useRef<Map<string, string>>(new Map())
  const [pendingChordIds, setPendingChordIds] = useState<Set<string>>(new Set())
  sectionsRef.current = sections
  activeEditRef.current = activeEdit

  // Reset when leaving edit mode
  useEffect(() => {
    if (!editMode) {
      setSelMode('idle')
      setSelStart(null)
      setSelEnd(null)
      setHint(null)
      setActiveEdit(null)
    }
  }, [editMode])

  // Keyboard shortcuts
  useEffect(() => {
    if (!editMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (activeEdit) { setActiveEdit(null); return }
      if (selMode !== 'idle') { resetSel(); return }
      onEditModeChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, activeEdit, selMode, onEditModeChange])

  const effectiveProject = editMode
    ? { ...project, time_signature: timeSignature }
    : project
  const { barDurationMs, totalBars } = getBarMath(effectiveProject, totalDurationMs)
  const labelStep = totalBars <= 32 ? 1 : totalBars <= 64 ? 2 : 4

  // Time-based position: maps bar → 0..1 fraction, matching waveform scale
  const tp = (bar: number) =>
    totalDurationMs > 0 ? (bar * barDurationMs) / totalDurationMs : bar / Math.max(1, totalBars)

  const wl = waveformBounds?.left ?? 228
  const wr = waveformBounds?.right ?? 68

  const STRIP_H = editMode ? 38 : 34
  const TACTS_H = 16 + STRIP_H

  const activeSection = activeEdit
    ? sections.find(s => s.id === activeEdit.sectionId)
    : undefined

  const playheadPct = totalDurationMs > 0
    ? Math.min(100, (currentTimeMs / totalDurationMs) * 100)
    : 0

  const ticks: number[] = []
  for (let i = 0; i <= totalBars; i++) ticks.push(i)

  function resetSel() {
    setSelMode('idle')
    setSelStart(null)
    setSelEnd(null)
    setHint(null)
  }

  function barFromClientX(clientX: number) {
    const el = stripRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(
      Math.floor(((clientX - rect.left) / rect.width) * totalDurationMs / Math.max(barDurationMs, 1)),
      totalBars - 1
    ))
  }

  function updateActiveEditPos(sectionId: string, start: number, end: number) {
    const el = stripRef.current
    if (!el || activeEditRef.current?.sectionId !== sectionId) return
    const rect = el.getBoundingClientRect()
    setActiveEdit({
      sectionId,
      cellPos: {
        left: rect.left + tp(start) * rect.width,
        top: rect.top,
        width: (tp(end) - tp(start)) * rect.width,
        height: rect.height,
      },
    })
  }

  function beginResize(e: React.MouseEvent, sectionId: string, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()

    const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar)
    const idx = sorted.findIndex(s => s.id === sectionId)
    const section = sorted[idx]
    if (!section) return

    const prev = idx > 0 ? sorted[idx - 1] : null
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null

    resizeDragRef.current = {
      sectionId,
      edge,
      origStart: section.start_bar,
      origEnd: section.end_bar,
      minStart: prev ? prev.end_bar : 0,
      maxStart: section.end_bar - 1,
      minEnd: section.start_bar + 1,
      maxEnd: next ? next.start_bar : totalBars,
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent) {
      const drag = resizeDragRef.current
      if (!drag) return

      const bar = barFromClientX(ev.clientX)
      const cur = sectionsRef.current.find(s => s.id === drag.sectionId)
      if (!cur) return

      let start = cur.start_bar
      let end = cur.end_bar
      if (drag.edge === 'start') {
        start = Math.max(drag.minStart, Math.min(bar, drag.maxStart))
      } else {
        end = Math.max(drag.minEnd, Math.min(bar + 1, drag.maxEnd))
      }
      if (start === cur.start_bar && end === cur.end_bar) return

      const updated = sectionsRef.current
        .map(s => s.id === drag.sectionId ? { ...s, start_bar: start, end_bar: end } : s)
        .sort((a, b) => a.start_bar - b.start_bar)
      sectionsRef.current = updated
      onSectionsChange(updated)
      updateActiveEditPos(drag.sectionId, start, end)
      setHint({ text: `Bars ${start + 1}–${end}`, isError: false })
    }

    function onUp() {
      const drag = resizeDragRef.current
      resizeDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)

      if (!drag) return
      const sec = sectionsRef.current.find(s => s.id === drag.sectionId)
      if (sec && (sec.start_bar !== drag.origStart || sec.end_bar !== drag.origEnd)) {
        fetch(`/api/sections/${drag.sectionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ start_bar: sec.start_bar, end_bar: sec.end_bar }),
        }).catch(console.error)
      }
      setHint(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleStripMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (selMode === 'naming' || resizeDragRef.current) return
    e.preventDefault()

    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))

    // View mode — click anywhere on the strip to seek
    if (!editMode) {
      const seekDuration = duration > 0 ? duration : totalDurationMs / 1000
      if (seekDuration > 0) onSeek(ratio * seekDuration)
      return
    }

    const bar = Math.max(0, Math.min(
      Math.floor(ratio * totalDurationMs / Math.max(barDurationMs, 1)),
      totalBars - 1
    ))

    // Edit mode — click on existing section to select
    const hit = sections.find(s => bar >= s.start_bar && bar < s.end_bar)
    if (hit) {
      if (!activeEdit || activeEdit.sectionId !== hit.id) {
        const sLeft = rect.left + tp(hit.start_bar) * rect.width
        const sWidth = (tp(hit.end_bar) - tp(hit.start_bar)) * rect.width
        setActiveEdit({
          sectionId: hit.id,
          cellPos: { left: sLeft, top: rect.top, width: sWidth, height: rect.height },
        })
      }
      return
    }

    if (activeEdit) return

    // Placement flow
    if (selMode === 'idle') {
      setSelStart(bar)
      setSelMode('start_set')
      setHint({ text: `Bar ${bar + 1} — click to set end`, isError: false })
      return
    }

    if (selMode === 'start_set' && selStart !== null) {
      if (bar < selStart) {
        setHint({ text: 'Click to the right of the start', isError: true })
        return
      }
      const endBar = bar + 1
      const overlap = sections.find(s => selStart < s.end_bar && endBar > s.start_bar)
      if (overlap) {
        setHint({ text: `Overlaps with "${sectionLabel(overlap)}"`, isError: true })
        return
      }
      setSelEnd(endBar)
      setSelMode('naming')
      setHint(null)
    }
  }

  async function handleConfirmNew(type: SectionType, customName?: string) {
    if (selStart === null || selEnd === null) return
    const c = SECTION_COLORS[type] ?? SECTION_COLORS.custom
    try {
      const res = await fetch(`/api/versions/${versionId}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, custom_name: customName ?? null,
          start_bar: selStart, end_bar: selEnd,
          color: c.bg, position: sections.length,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const { section } = await res.json()
      onSectionsChange([...sections, section].sort((a, b) => a.start_bar - b.start_bar))
    } catch (err) {
      console.error(err)
    }
    resetSel()
  }

  function handleTypeChange(id: string, type: SectionType, customName?: string) {
    const c = SECTION_COLORS[type] ?? SECTION_COLORS.custom
    onSectionsChange(sections.map(s =>
      s.id === id ? { ...s, type, custom_name: customName ?? null, color: c.bg } : s
    ))
    fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, custom_name: customName ?? null, color: c.bg }),
    }).catch(console.error)
  }

  function handleChordsLocalChange(id: string, chords: string) {
    onSectionsChange(sections.map(s => s.id === id ? { ...s, chords } : s))
    pendingChordSavesRef.current.set(id, chords)
    setPendingChordIds(prev => new Set(prev).add(id))
  }

  async function handleChordsAutoSave(id: string, chords: string): Promise<void> {
    await fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chords }),
    })
    pendingChordSavesRef.current.delete(id)
    setPendingChordIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleDone() {
    const pending = Array.from(pendingChordSavesRef.current.entries())
    if (pending.length > 0) {
      await Promise.allSettled(
        pending.map(([id, chords]) =>
          fetch(`/api/sections/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chords }),
          })
          .then(() => {
            pendingChordSavesRef.current.delete(id)
            setPendingChordIds(prev => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          })
          .catch(console.error)
        )
      )
    }
    onEditModeChange(false)
  }

  function handleDelete(id: string) {
    onSectionsChange(sections.filter(s => s.id !== id))
    setActiveEdit(null)
    fetch(`/api/sections/${id}`, { method: 'DELETE' }).catch(console.error)
  }

  return (
    <>
      <div style={{
        background: 'var(--bg-surface)',
        borderBottom: '0.5px solid var(--border)',
        flexShrink: 0,
        transition: 'box-shadow 0.2s',
        userSelect: 'none',
      }}>

        {/* Edit mode header row */}
        {editMode && (
          <div style={{
            height: 34, display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 10px',
            borderBottom: '0.5px solid var(--border)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', letterSpacing: '0.06em' }}>
              STRUCTURE
            </span>
            <select value={timeSignature} onChange={e => setTimeSignature(e.target.value)}
              style={{
                background: 'transparent', border: '0.5px solid var(--border)',
                borderRadius: 4, padding: '2px 4px',
                fontSize: 11, color: 'var(--text-muted)',
                cursor: 'pointer', outline: 'none',
              }}>
              {['4/4', '3/4', '6/8', '2/4', '5/4', '7/8'].map(ts => (
                <option key={ts} value={ts}>{ts}</option>
              ))}
            </select>

            {hint ? (
              <span style={{ fontSize: 11, flex: 1, color: hint.isError ? '#ef4444' : 'var(--accent)' }}>
                {hint.text}
              </span>
            ) : (
              <span style={{ fontSize: 11, flex: 1, color: 'var(--text-dim)' }}>
                {sections.length === 0
                  ? 'Click the strip to place your first section'
                  : `${sections.length} section${sections.length !== 1 ? 's' : ''} — drag edges to resize, click empty space to add`}
              </span>
            )}

            <div style={{ display: 'flex', gap: 5 }}>
              {selMode === 'start_set' && (
                <button onClick={resetSel} style={{
                  padding: '0 8px', height: 26, borderRadius: 5, fontSize: 11,
                  background: 'transparent', border: '0.5px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}>Cancel</button>
              )}
              <button onClick={handleDone} style={{
                padding: '0 14px', height: 26, borderRadius: 5, fontSize: 11, fontWeight: 500,
                background: 'var(--accent)', border: 'none', color: 'white', cursor: 'pointer',
              }}>Done</button>
            </div>
          </div>
        )}

        {/* Tacts row — transport flanks ruler + section strip */}
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ width: wl, flexShrink: 0, height: TACTS_H, display: 'flex', alignItems: 'center' }}>
            <StructureTransport
              side="left"
              playing={playing} currentTime={currentTime} duration={duration}
              loaded={loaded} totalTracks={totalTracks} volume={volume}
              onPlay={onPlay} onPause={onPause} onVolume={onVolume}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Bar ruler — numbers only */}
            <div style={{ position: 'relative', height: 16, overflow: 'hidden' }}>
              {totalBars <= 160 && ticks.filter(bar => bar % labelStep === 0).map(bar => (
                <span key={bar} style={{
                  position: 'absolute',
                  left: `${tp(bar) * 100}%`,
                  top: 2,
                  transform: 'translateX(-50%)',
                  fontSize: 9, fontWeight: 600, lineHeight: 1,
                  color: 'var(--text-muted)', whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}>{bar + 1}</span>
              ))}
            </div>

            {/* Section strip */}
            <div
              ref={stripRef}
              onMouseDown={handleStripMouseDown}
              style={{
                position: 'relative', height: STRIP_H,
                background: 'var(--bg-card)',
                borderTop: '0.5px solid var(--border)',
                cursor: !editMode
                  ? 'pointer'
                  : activeEdit ? 'default'
                  : selMode === 'naming' ? 'default'
                  : 'crosshair',
                overflow: 'hidden',
              }}
            >
            {/* Bar grid lines — confined to strip height, matching sections */}
            {totalBars <= 160 && ticks.map(bar => {
              const isMajor = bar % labelStep === 0
              return (
                <div key={bar} style={{
                  position: 'absolute',
                  top: 0, height: '100%',
                  left: `${tp(bar) * 100}%`,
                  width: 1,
                  marginLeft: -0.5,
                  background: isMajor ? 'var(--text-dim)' : 'var(--border-light)',
                  opacity: isMajor ? 0.6 : 0.38,
                  pointerEvents: 'none',
                }} />
              )
            })}

            {/* Playback playhead */}
            {totalDurationMs > 0 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${playheadPct}%`,
                width: 2, marginLeft: -1,
                background: 'var(--accent)',
                boxShadow: '0 0 6px rgba(99,102,241,0.55)',
                pointerEvents: 'none', zIndex: 15,
              }} />
            )}

            {/* Section cells */}
            {sections.map(s => {
              const c = SECTION_COLORS[s.type] ?? SECTION_COLORS.custom
              const isActive = activeEdit?.sectionId === s.id
              return (
                <div key={s.id} style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: `${tp(s.start_bar) * 100}%`,
                  width: `${(tp(s.end_bar) - tp(s.start_bar)) * 100}%`,
                  background: c.bg,
                  borderLeft: pendingChordIds.has(s.id) ? '2px solid #F59E0B' : `2px solid ${c.fg}`,
                  overflow: 'visible',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  paddingLeft: 5,
                  cursor: editMode ? 'pointer' : 'inherit',
                  outline: isActive ? `1.5px solid ${c.fg}` : 'none',
                  outlineOffset: -1,
                  zIndex: isActive ? 8 : 6,
                }}>
                  <span style={{
                    fontSize: 10, color: c.fg, fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    lineHeight: 1.3,
                    pointerEvents: 'none',
                  }}>{sectionLabel(s)}</span>
                  {/* Chords shown in view mode only (edit mode uses the chord bar below) */}
                  {!editMode && s.chords && (
                    <span style={{
                      fontSize: 9, color: `${c.fg}bb`,
                      fontFamily: 'var(--font-mono, monospace)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      lineHeight: 1.3,
                      pointerEvents: 'none',
                    }}>{s.chords.replace(/\n/g, ' ').slice(0, 28)}</span>
                  )}
                  {editMode && (
                    <>
                      <div
                        onMouseDown={e => beginResize(e, s.id, 'start')}
                        title="Drag to resize"
                        style={{
                          position: 'absolute', left: -3, top: 0, bottom: 0,
                          width: 8, cursor: 'ew-resize', zIndex: 10,
                        }}
                      >
                        <div style={{
                          position: 'absolute', left: 3, top: '15%', bottom: '15%',
                          width: 2, borderRadius: 1,
                          background: isActive ? c.fg : 'var(--border-light)',
                          opacity: isActive ? 1 : 0.7,
                        }} />
                      </div>
                      <div
                        onMouseDown={e => beginResize(e, s.id, 'end')}
                        title="Drag to resize"
                        style={{
                          position: 'absolute', right: -3, top: 0, bottom: 0,
                          width: 8, cursor: 'ew-resize', zIndex: 10,
                        }}
                      >
                        <div style={{
                          position: 'absolute', right: 3, top: '15%', bottom: '15%',
                          width: 2, borderRadius: 1,
                          background: isActive ? c.fg : 'var(--border-light)',
                          opacity: isActive ? 1 : 0.7,
                        }} />
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* In-progress selection highlight */}
            {editMode && selStart !== null && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${tp(selStart) * 100}%`,
                width: selEnd !== null
                  ? `${(tp(selEnd) - tp(selStart)) * 100}%`
                  : 1.5,
                background: selEnd !== null ? 'rgba(99,102,241,0.18)' : 'transparent',
                borderLeft: '1.5px solid var(--accent)',
                borderRight: selEnd !== null ? '1.5px solid var(--accent)' : 'none',
                pointerEvents: 'none',
              }} />
            )}

            {/* Empty strip hint */}
            {editMode && sections.length === 0 && selMode === 'idle' && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: 'var(--text-dim)', pointerEvents: 'none',
              }}>click to place first section</div>
            )}
            </div>
          </div>

          <div style={{ width: wr, flexShrink: 0, height: TACTS_H, display: 'flex', alignItems: 'center' }}>
            <StructureTransport
              side="right"
              playing={playing} currentTime={currentTime} duration={duration}
              loaded={loaded} totalTracks={totalTracks} volume={volume}
              onPlay={onPlay} onPause={onPause} onVolume={onVolume}
            />
          </div>
        </div>

      </div>

      {/* Name picker portal */}
      {selMode === 'naming' && selStart !== null && selEnd !== null && (
        <NamePickerPortal
          selectionStart={selStart}
          selectionEnd={selEnd}
          barDurationMs={barDurationMs}
          totalDurationMs={totalDurationMs}
          stripRef={stripRef}
          onConfirm={handleConfirmNew}
          onCancel={resetSel}
        />
      )}

      {/* Section edit popover */}
      {activeSection && activeEdit && (
        <SectionEditPopover
          section={activeSection}
          cellPos={activeEdit.cellPos}
          onTypeChange={handleTypeChange}
          onChordsLocalChange={handleChordsLocalChange}
          onChordsAutoSave={handleChordsAutoSave}
          onDelete={handleDelete}
          onClose={() => setActiveEdit(null)}
        />
      )}
    </>
  )
}

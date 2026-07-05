'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { Project, Section, SectionType, Track } from '@/lib/types'
import { ChordInput } from '@/components/ChordInput'
import { ChordPlaybackRow } from '@/components/ChordPlaybackRow'
import { detectChordsInAudio } from '@/lib/chordDetection'
import { trackEvent } from '@/lib/analytics'
import { trackAccentColor } from '@/lib/trackIcon'
import { sectionBarCount, updateSectionChordDuration } from '@/lib/chords'
import {
  barDurationSec,
  getMergedToneBuffer,
  sectionTimeRangeSec,
  sliceSectionFromToneBuffer,
} from '@/lib/mergedAudioBuffer'
import { useMobileKeyboardInset } from '@/hooks/useMobileKeyboardInset'
import { TbButton } from '@/components/design/TbButton'

/** Stored on section rows for merge/API; UI uses lime tokens, not this value. */
const SECTION_STORED_COLOR = 'var(--lime-soft)'

const SECTION_TYPES: SectionType[] = [
  'intro', 'verse', 'chorus', 'pre-chorus', 'bridge', 'drop', 'breakdown', 'outro', 'custom',
]

const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  intro: 'Intro', verse: 'Verse', chorus: 'Chorus',
  'pre-chorus': 'Pre-Ch.', bridge: 'Bridge', drop: 'Drop',
  breakdown: 'Breakdown', outro: 'Outro', custom: 'Custom',
}

const BARS_PER_TACT = 4

function sectionDisplayRange(s: Section): string {
  return `${s.start_bar + 1}–${s.end_bar}`
}

function RangeStepper({
  label, value, min, max, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="flex border border-border">
        <button type="button" onClick={() => set(value - 1)} className="px-2 text-xs hover:bg-surface border-r border-border">−</button>
        <input
          value={value}
          onChange={e => set(parseInt(e.target.value || '0', 10) || min)}
          className="flex-1 bg-transparent text-center text-xs font-mono tabular-nums focus:outline-none w-0 min-w-0"
        />
        <button type="button" onClick={() => set(value + 1)} className="px-2 text-xs hover:bg-surface border-l border-border">+</button>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function sectionLabel(s: Section): string {
  return s.custom_name ?? (s.type.charAt(0).toUpperCase() + s.type.slice(1))
}

function trackLabel(t: Track): string {
  return t.display_name ?? t.name ?? t.original_filename ?? 'Track'
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

/** Bordered popover caret — outer triangle for stroke, inner for fill. */
function PopoverCaret({
  side,
  left,
  borderColor = 'var(--accent)',
  fillColor = 'var(--bg-surface)',
}: {
  side: 'top' | 'bottom'
  left: number
  borderColor?: string
  fillColor?: string
}) {
  const fill = 5
  const stroke = 6
  const shared = {
    position: 'absolute' as const,
    width: 0,
    height: 0,
    pointerEvents: 'none' as const,
  }
  const borderTri = side === 'top'
    ? {
        ...shared,
        top: -stroke,
        left: left - stroke,
        borderLeft: `${stroke}px solid transparent`,
        borderRight: `${stroke}px solid transparent`,
        borderBottom: `${stroke}px solid ${borderColor}`,
      }
    : {
        ...shared,
        bottom: -stroke,
        left: left - stroke,
        borderLeft: `${stroke}px solid transparent`,
        borderRight: `${stroke}px solid transparent`,
        borderTop: `${stroke}px solid ${borderColor}`,
      }
  const fillTri = side === 'top'
    ? {
        ...shared,
        top: -fill,
        left: left - fill,
        borderLeft: `${fill}px solid transparent`,
        borderRight: `${fill}px solid transparent`,
        borderBottom: `${fill}px solid ${fillColor}`,
      }
    : {
        ...shared,
        bottom: -fill,
        left: left - fill,
        borderLeft: `${fill}px solid transparent`,
        borderRight: `${fill}px solid transparent`,
        borderTop: `${fill}px solid ${fillColor}`,
      }
  return (
    <>
      <div style={borderTri} />
      <div style={fillTri} />
    </>
  )
}

// ─── Name picker portal (new section placement) ───────────────────────────────

function NamePickerPortal({
  selectionStart, selectionEnd, totalBars, barDurationMs, totalDurationMs, stripRef,
  onConfirm, onCancel, onRangeChange,
}: {
  selectionStart: number
  selectionEnd: number
  totalBars: number
  barDurationMs: number
  totalDurationMs: number
  stripRef: React.RefObject<HTMLDivElement | null>
  onConfirm: (type: SectionType, customName?: string, chords?: string) => void
  onCancel: () => void
  onRangeChange: (start: number, end: number) => void
}) {
  const pickerRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')
  const [chords, setChords] = useState('')

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

  const W = 320
  const POPOVER_H = 420
  let pLeft = 8, pTop = 200, flippedPicker = false

  if (typeof window !== 'undefined' && stripRef.current) {
    const rect = stripRef.current.getBoundingClientRect()
    const midMs = ((selectionStart + selectionEnd) / 2) * barDurationMs
    const cx = rect.left + (totalDurationMs > 0 ? midMs / totalDurationMs : 0.5) * rect.width
    pLeft = Math.max(8, Math.min(cx - W / 2, window.innerWidth - W - 8))
    if (rect.top < POPOVER_H + 8) {
      pTop = rect.bottom + 8
      flippedPicker = true
    } else {
      pTop = rect.top - 8
    }
  }

  function confirmType(type: SectionType, name?: string) {
    onConfirm(type, name, chords.trim() || undefined)
  }

  return createPortal(
    <div ref={pickerRef} className="fixed z-[200] w-[320px] border border-border bg-popover shadow-2xl animate-slide-in"
      style={{ top: pTop, left: pLeft, transform: flippedPicker ? 'none' : 'translateY(-100%)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Bars {selectionStart + 1}–{selectionEnd}
          <span className="text-foreground/60"> · {selectionEnd - selectionStart} bars</span>
        </div>
        <button type="button" onClick={onCancel} className="size-5 grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Close">×</button>
      </div>
      <div className="p-3 space-y-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">Section</div>
          {customMode ? (
            <div className="space-y-2">
              <input ref={customInputRef} value={customName}
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && customName.trim()) confirmType('custom', customName.trim())
                  if (e.key === 'Escape') setCustomMode(false)
                }}
                placeholder="My section"
                className="w-full bg-surface border border-border px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-foreground/40"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setCustomMode(false)}
                  className="flex-1 text-[10px] uppercase tracking-widest border border-border py-1.5 hover:border-foreground/40">Back</button>
                <button type="button" onClick={() => { if (customName.trim()) confirmType('custom', customName.trim()) }} disabled={!customName.trim()}
                  className="flex-1 text-[10px] uppercase tracking-widest border border-border py-1.5 hover:border-foreground/40 disabled:opacity-40">Save</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {SECTION_TYPES.map(type => (
                <button key={type} type="button"
                  onClick={() => type === 'custom' ? setCustomMode(true) : confirmType(type)}
                  className="text-[10px] uppercase tracking-widest py-1.5 border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground transition truncate"
                >{SECTION_TYPE_LABELS[type]}</button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Chords</div>
          <ChordInput
            value={chords}
            onChange={setChords}
            placeholder="Type chords, space to add"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <RangeStepper label="Start bar" value={selectionStart + 1} min={1} max={selectionEnd}
            onChange={v => onRangeChange(v - 1, selectionEnd)} />
          <RangeStepper label="End bar" value={selectionEnd} min={selectionStart + 1} max={totalBars}
            onChange={v => onRangeChange(selectionStart, v)} />
        </div>

        <div className="flex justify-between gap-2 pt-1 border-t border-border">
          <button type="button" onClick={onCancel}
            className="text-[10px] uppercase tracking-widest text-destructive hover:underline">
            Remove
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Section edit popover ─────────────────────────────────────────────────────

type CellPos = { left: number; top: number; width: number; height: number }

const POPOVER_VIEWPORT_GAP = 8

function clampSectionEditPopoverPosition(
  cellPos: CellPos,
  popoverWidth: number,
  popoverHeight: number,
): { left: number; top: number } {
  const gap = POPOVER_VIEWPORT_GAP
  const left = Math.max(
    gap,
    Math.min(cellPos.left + cellPos.width / 2 - popoverWidth / 2, window.innerWidth - popoverWidth - gap),
  )

  const preferBelow = cellPos.top < popoverHeight + gap
  let top = preferBelow
    ? cellPos.top + cellPos.height + gap
    : cellPos.top - gap - popoverHeight

  top = Math.max(gap, Math.min(top, window.innerHeight - popoverHeight - gap))
  return { left, top }
}

export function SectionEditPopover({
  section, cellPos, detectingChords, audioTracks, totalBars,
  onTypeChange, onChordsLocalChange, onChordsAutoSave, onDetectChords, onBarRangeChange, onDelete, onClose,
  layout = 'popover',
}: {
  section: Section
  cellPos: CellPos
  detectingChords: boolean
  audioTracks: Track[]
  totalBars: number
  onTypeChange: (id: string, type: SectionType, customName?: string) => void
  onChordsLocalChange: (id: string, chords: string) => void
  onChordsAutoSave: (id: string, chords: string) => Promise<void>
  onDetectChords: (trackIds: string[]) => void
  onBarRangeChange: (id: string, startBar: number, endBar: number) => void
  onDelete: (id: string) => void
  onClose: () => void
  layout?: 'popover' | 'sheet'
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Holds the latest unsaved chords value + section id so we can flush on unmount
  const pendingRef = useRef<{ id: string; chords: string } | null>(null)
  const onChordsAutoSaveRef = useRef(onChordsAutoSave)
  onChordsAutoSaveRef.current = onChordsAutoSave
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState(section.custom_name ?? '')
  const [chords, setChords] = useState(section.chords ?? '')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isDirty, setIsDirty] = useState(false)
  const wasDetectingRef = useRef(detectingChords)
  const [trackPickerOpen, setTrackPickerOpen] = useState(false)
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setSelectedTrackIds(new Set())
    setTrackPickerOpen(false)
  }, [section.id, audioTracks.map(t => t.id).join('|')])

  useEffect(() => {
    setIsDirty(false)
    setChords(section.chords ?? '')
    setSaveStatus('idle')
  }, [section.id])

  // Sync from parent only when not editing.
  useEffect(() => {
    if (!isDirty && saveStatus !== 'saving') setChords(section.chords ?? '')
  }, [section.chords, isDirty, saveStatus])

  // When detection finishes, push chords into the textarea without closing the popover.
  useEffect(() => {
    const wasDetecting = wasDetectingRef.current
    wasDetectingRef.current = detectingChords
    if (wasDetecting && !detectingChords && section.chords?.trim() && !isDirty) {
      setChords(section.chords)
      setSaveStatus('saved')
      const t = setTimeout(() => setSaveStatus('idle'), 1500)
      return () => clearTimeout(t)
    }
  }, [detectingChords, section.chords, isDirty])

  // Flush pending save on unmount (fire-and-forget)
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        if (pendingRef.current) {
          const { id, chords: pendingChords } = pendingRef.current
          onChordsAutoSaveRef.current(id, pendingChords).catch(() => { /* ignore on unmount */ })
        }
      }
    }
  }, [])

  function handleChordsChange(val: string) {
    setChords(val)
    setIsDirty(true)
    pendingRef.current = { id: section.id, chords: val }
    onChordsLocalChange(section.id, val)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (!pending || pending.id !== section.id) return
      const val = pending.chords
      setSaveStatus('saving')
      try {
        await onChordsAutoSave(section.id, val)
        setChords(val)
        setIsDirty(false)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1500)
      } catch {
        setSaveStatus('error')
        pendingRef.current = { id: section.id, chords: val }
        setIsDirty(true)
      }
    }, 800)
  }

  useEffect(() => { if (customMode) customInputRef.current?.focus() }, [customMode])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target)) return
      // Strip section clicks open/switch the popover on the same mousedown — don't close.
      if (target instanceof Element && target.closest('[data-structure-section]')) return
      // Duration picker is portaled to document.body — keep popover open while editing.
      if (target instanceof Element && target.closest('[data-chord-duration-picker]')) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (trackPickerOpen) setTrackPickerOpen(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, trackPickerOpen])

  function handleTypeClick(type: SectionType) {
    if (type === 'custom') { setCustomMode(true); return }
    onTypeChange(section.id, type)
  }

  function handleCustomConfirm() {
    if (!customName.trim()) return
    onTypeChange(section.id, 'custom', customName.trim())
    setCustomMode(false)
  }

  function toggleTrack(id: string) {
    setSelectedTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleRunDetection() {
    const ids = audioTracks.filter(t => selectedTrackIds.has(t.id)).map(t => t.id)
    if (ids.length === 0) return
    setTrackPickerOpen(false)
    onDetectChords(ids)
  }

  const isSheet = layout === 'sheet'

  const [popoverCoords, setPopoverCoords] = useState<{ left: number; top: number }>(() => ({
    left: Math.max(POPOVER_VIEWPORT_GAP, cellPos.left + cellPos.width / 2 - 160),
    top: POPOVER_VIEWPORT_GAP,
  }))

  const repositionPopover = useCallback(() => {
    if (typeof window === 'undefined' || isSheet) return
    const popover = popoverRef.current
    if (!popover) return
    setPopoverCoords(
      clampSectionEditPopoverPosition(cellPos, popover.offsetWidth, popover.offsetHeight),
    )
  }, [cellPos, isSheet])

  useLayoutEffect(() => {
    if (isSheet) return
    repositionPopover()
    const id = requestAnimationFrame(repositionPopover)
    return () => cancelAnimationFrame(id)
  }, [
    isSheet,
    repositionPopover,
    trackPickerOpen,
    customMode,
    section.id,
    chords,
    detectingChords,
    audioTracks.length,
  ])

  useEffect(() => {
    if (isSheet) return
    window.addEventListener('resize', repositionPopover)
    window.addEventListener('scroll', repositionPopover, true)
    return () => {
      window.removeEventListener('resize', repositionPopover)
      window.removeEventListener('scroll', repositionPopover, true)
    }
  }, [isSheet, repositionPopover])

  const barCount = sectionBarCount(section, totalBars)
  const { keyboardInset, viewportHeight } = useMobileKeyboardInset(isSheet)

  const sheetPanelStyle = isSheet
    ? {
        bottom: keyboardInset > 0 ? keyboardInset : 0,
        maxHeight:
          keyboardInset > 0 && viewportHeight
            ? `${viewportHeight}px`
            : undefined,
      }
    : undefined

  useEffect(() => {
    if (!isSheet) return
    const root = popoverRef.current
    if (!root) return
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (!(target instanceof HTMLInputElement)) return
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
    root.addEventListener('focusin', onFocusIn)
    return () => root.removeEventListener('focusin', onFocusIn)
  }, [isSheet])

  const panel = (
    <div
      ref={popoverRef}
      className={
        isSheet
          ? 'fixed inset-x-0 bottom-0 z-[220] max-h-[85vh] overflow-y-auto overscroll-contain border-t border-border bg-popover shadow-2xl animate-slide-in'
          : 'fixed z-[200] w-[320px] border border-border bg-popover shadow-2xl animate-slide-in'
      }
      style={isSheet ? sheetPanelStyle : { top: popoverCoords.top, left: popoverCoords.left }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Bars {section.start_bar + 1}–{section.end_bar}
          <span className="text-foreground/60"> · {barCount} bars</span>
        </div>
        <button type="button" onClick={onClose} className="size-5 grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Close">×</button>
      </div>

      <div className="p-3 space-y-3">
          <div>
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">Section</div>
            {customMode ? (
              <div className="space-y-2">
                <input ref={customInputRef} value={customName} onChange={e => setCustomName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCustomConfirm(); if (e.key === 'Escape') setCustomMode(false) }}
                  placeholder="My section"
                  className="w-full bg-surface border border-border px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-foreground/40"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomMode(false)}
                    className="flex-1 text-[10px] uppercase tracking-widest border border-border py-1.5">Back</button>
                  <button type="button" onClick={handleCustomConfirm} disabled={!customName.trim()}
                    className="flex-1 text-[10px] uppercase tracking-widest border border-border py-1.5 disabled:opacity-40">Save</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {SECTION_TYPES.map(type => {
                  const active = section.type === type
                  return (
                    <button key={type} type="button" onClick={() => handleTypeClick(type)}
                      className={`text-[10px] uppercase tracking-widest py-1.5 border transition truncate ${
                        active ? 'border-foreground/50 text-foreground bg-surface' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                      }`}
                    >
                      {type === 'custom' && section.type === 'custom' ? sectionLabel(section) : SECTION_TYPE_LABELS[type]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {section.type === 'custom' && !customMode && (
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Label</div>
              <input value={customName} onChange={e => setCustomName(e.target.value)}
                onBlur={() => customName.trim() && handleCustomConfirm()}
                className="w-full bg-surface border border-border px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-foreground/40"
                placeholder="My section"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Chords
                {detectingChords && <span className="text-lime"> · detecting…</span>}
                {!detectingChords && isDirty && saveStatus === 'idle' && <span className="text-amber"> · unsaved</span>}
                {!detectingChords && saveStatus === 'saving' && <span> · saving…</span>}
                {!detectingChords && saveStatus === 'saved' && <span className="text-online"> · saved</span>}
              </div>
              {audioTracks.length > 0 && !trackPickerOpen && (
                <button
                  type="button"
                  disabled={detectingChords}
                  onClick={() => {
                    setSelectedTrackIds(new Set())
                    setTrackPickerOpen(true)
                  }}
                  className="text-[9px] uppercase tracking-widest border border-border px-2 py-0.5 hover:border-foreground/40 disabled:opacity-50"
                >
                  Detect
                </button>
              )}
            </div>
            <div style={{ borderColor: isDirty && saveStatus === 'idle' ? '#F59E0B' : undefined }}>
              <ChordInput
                value={chords}
                disabled={detectingChords}
                onChange={handleChordsChange}
                placeholder={detectingChords ? 'Analyzing audio…' : 'Type chords, space to add'}
              />
            </div>
            {trackPickerOpen && (
              <div className="mt-2 p-2 border border-border bg-surface">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground m-0">Tracks to analyze</p>
                <div className="mt-3 max-h-[9.5rem] overflow-y-auto overscroll-contain flex flex-col gap-1.5">
                  {audioTracks.map((track, index) => {
                    const selected = selectedTrackIds.has(track.id)
                    const accent = trackAccentColor(track.icon_color, index)
                    return (
                      <label
                        key={track.id}
                        className="block w-full shrink-0 cursor-pointer border px-3 py-1.5 text-[11px] font-mono transition-colors min-w-0"
                        style={{
                          borderColor: accent,
                          backgroundColor: selected ? accent : 'transparent',
                          color: selected ? '#fff' : accent,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleTrack(track.id)}
                          className="sr-only"
                        />
                        <span className="block truncate">{trackLabel(track)}</span>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-2 flex gap-2 justify-end">
                  <button type="button" onClick={() => setTrackPickerOpen(false)} className="text-[10px] uppercase tracking-widest border border-border px-2 py-1">Cancel</button>
                  <button type="button" disabled={selectedTrackIds.size === 0} onClick={handleRunDetection}
                    className="text-[10px] uppercase tracking-widest bg-foreground text-background px-2 py-1 disabled:opacity-40">Run</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <RangeStepper label="Start bar" value={section.start_bar + 1} min={1} max={section.end_bar}
              onChange={v => onBarRangeChange(section.id, v - 1, section.end_bar)} />
            <RangeStepper label="End bar" value={section.end_bar} min={section.start_bar + 1} max={totalBars}
              onChange={v => onBarRangeChange(section.id, section.start_bar, v)} />
          </div>

          <div className="flex justify-between gap-2 pt-1 border-t border-border">
            <button type="button" onClick={() => onDelete(section.id)}
              className="text-[10px] uppercase tracking-widest text-destructive hover:underline">
              Remove
            </button>
            <button type="button" onClick={onClose}
              className="text-[10px] uppercase tracking-widest border border-border px-3 py-1.5 hover:border-foreground/40">
              Done
            </button>
          </div>
      </div>
    </div>
  )

  if (isSheet) {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-[219] bg-black/50"
          style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
          onClick={onClose}
        />
        {panel}
      </>,
      document.body,
    )
  }

  return createPortal(panel, document.body)
}

// ─── Section edit actions (shared with mobile mixer) ─────────────────────────

export function useSectionEditActions({
  project, versionId, tracks, sections, onSectionsChange, totalDurationMs,
}: {
  project: Project
  versionId: string
  tracks: Track[]
  sections: Section[]
  onSectionsChange: Dispatch<SetStateAction<Section[]>>
  totalDurationMs: number
}) {
  const [detectingChordsFor, setDetectingChordsFor] = useState<string | null>(null)
  const pendingChordSavesRef = useRef<Map<string, string>>(new Map())
  const audioTracks = tracks.filter(t => t.file_type !== 'midi')
  const { totalBars } = getBarMath(project, totalDurationMs)

  function handleTypeChange(id: string, type: SectionType, customName?: string) {
    onSectionsChange(prev => prev.map(s =>
      s.id === id ? { ...s, type, custom_name: customName ?? null, color: SECTION_STORED_COLOR } : s,
    ))
    fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, custom_name: customName ?? null, color: SECTION_STORED_COLOR }),
    }).catch(console.error)
  }

  function handleChordsLocalChange(id: string, chords: string) {
    onSectionsChange(prev =>
      prev.map(s => (s.id === id ? { ...s, chords } : s)),
    )
    pendingChordSavesRef.current.set(id, chords)
  }

  const chordSaveGenRef = useRef<Map<string, number>>(new Map())

  async function handleChordsAutoSave(id: string, chords: string): Promise<void> {
    const gen = (chordSaveGenRef.current.get(id) ?? 0) + 1
    chordSaveGenRef.current.set(id, gen)
    const res = await fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chords }),
    })
    if (!res.ok) throw new Error('Failed to save chords')
    if (chordSaveGenRef.current.get(id) !== gen) return
    onSectionsChange(prev => prev.map(s => (s.id === id ? { ...s, chords } : s)))
    pendingChordSavesRef.current.delete(id)
  }

  async function runChordDetection(section: Section, selectedTrackIds: string[]) {
    if (selectedTrackIds.length === 0) return
    setDetectingChordsFor(section.id)
    try {
      const bpm = project.bpm ?? 120
      const timeSig = project.time_signature ?? '4/4'
      const totalSec = totalDurationMs / 1000
      const barDurSec = barDurationSec(bpm, timeSig)
      const barCount = sectionBarCount(section, totalBars)
      const buffer = await getMergedToneBuffer(tracks, bpm, timeSig, totalSec, selectedTrackIds)
      if (!buffer) return
      const { startTimeSec, endTimeSec } = sectionTimeRangeSec(
        section.start_bar,
        section.start_bar + barCount,
        bpm,
        timeSig,
      )
      const slice = sliceSectionFromToneBuffer(buffer, startTimeSec, endTimeSec)
      if (slice.length === 0) return
      const detected = await detectChordsInAudio(slice, {
        sampleRate: buffer.sampleRate,
        barDurationSec: barDurSec,
        barCount,
      })
      if (!detected.trim()) return
      handleChordsLocalChange(section.id, detected)
      await handleChordsAutoSave(section.id, detected)
    } catch (err) {
      console.warn('[chordDetection]', err)
    } finally {
      setDetectingChordsFor(prev => (prev === section.id ? null : prev))
    }
  }

  function handleDetectChords(sectionId: string, selectedTrackIds: string[]) {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    trackEvent('chord_detect_clicked')
    void runChordDetection(section, selectedTrackIds)
  }

  function handleDelete(id: string) {
    onSectionsChange(prev => prev.filter(s => s.id !== id))
    fetch(`/api/sections/${id}`, { method: 'DELETE' }).catch(console.error)
  }

  function handleBarRangeChange(id: string, startBar: number, endBar: number) {
    const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar)
    const idx = sorted.findIndex(s => s.id === id)
    const section = sorted[idx]
    if (!section) return
    const prev = idx > 0 ? sorted[idx - 1] : null
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
    const minStart = prev ? prev.end_bar : 0
    const maxEnd = next ? next.start_bar : totalBars
    const start = Math.max(minStart, Math.min(startBar, endBar - 1))
    const end = Math.max(start + 1, Math.min(endBar, maxEnd))
    if (start === section.start_bar && end === section.end_bar) return
    onSectionsChange(prevSections =>
      prevSections
        .map(s => (s.id === id ? { ...s, start_bar: start, end_bar: end } : s))
        .sort((a, b) => a.start_bar - b.start_bar),
    )
    fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_bar: start, end_bar: end }),
    }).catch(console.error)
  }

  return {
    detectingChordsFor,
    audioTracks,
    totalBars,
    handleTypeChange,
    handleChordsLocalChange,
    handleChordsAutoSave,
    handleDetectChords,
    handleBarRangeChange,
    handleDelete,
  }
}

// ─── Structure overlay ────────────────────────────────────────────────────────

type SelMode = 'idle' | 'naming'
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
  project, versionId, totalDurationMs, tracks,
  sections, onSectionsChange,
  editMode, onEditModeChange,
  waveformBounds, currentTimeMs = 0,
  currentTimeRef, playing = false,
  onSeek, compact = false, seekEnabled = true,
}: {
  project: Project
  versionId: string
  totalDurationMs: number
  tracks: Track[]
  sections: Section[]
  onSectionsChange: Dispatch<SetStateAction<Section[]>>
  editMode: boolean
  onEditModeChange: (v: boolean) => void
  waveformBounds: { left: number; right: number } | null
  currentTimeMs?: number
  currentTimeRef?: React.RefObject<number>
  playing?: boolean
  onSeek: (t: number) => void
  /** Mobile landscape — shorter rows, sparse tact labels, no chords/edit UI */
  compact?: boolean
  /** False while tracks are still loading — disables ruler/structure scrub. */
  seekEnabled?: boolean
}) {
  const [selMode, setSelMode] = useState<SelMode>('idle')
  const [selStart, setSelStart] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const [hint, setHint] = useState<{ text: string; isError: boolean } | null>(null)
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const sectionsRef = useRef(sections)
  const activeEditRef = useRef(activeEdit)
  const resizeDragRef = useRef<ResizeDrag | null>(null)
  const newSectionDragRef = useRef<{ startBar: number } | null>(null)
  const pendingChordSavesRef = useRef<Map<string, string>>(new Map())
  const chordSaveGenRef = useRef<Map<string, number>>(new Map())
  const [pendingChordIds, setPendingChordIds] = useState<Set<string>>(new Set())
  const [detectingChordsFor, setDetectingChordsFor] = useState<string | null>(null)
  sectionsRef.current = sections
  activeEditRef.current = activeEdit

  const audioTracks = tracks.filter(t => t.file_type !== 'midi')

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

  const { barDurationMs, totalBars } = getBarMath(project, totalDurationMs)

  // Time-based position: maps bar → 0..1 fraction, matching waveform scale
  const tp = (bar: number) =>
    totalDurationMs > 0 ? (bar * barDurationMs) / totalDurationMs : bar / Math.max(1, totalBars)

  const wl = waveformBounds?.left ?? 192
  const wr = waveformBounds?.right ?? 68

  const RULER_H = compact ? 22 : 40
  const RIBBON_H = compact ? 22 : 32
  const CHORDS_H = compact ? 40 : 44
  const hasChords = sections.some(s => s.chords?.trim())

  function handlePlaybackChordDurationChange(
    sectionId: string,
    sectionChordIndex: number,
    duration: number,
  ) {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const next = updateSectionChordDuration(section.chords, sectionChordIndex, duration)
    handleChordsLocalChange(sectionId, next)
    void handleChordsAutoSave(sectionId, next)
  }
  const tactCount = Math.ceil(totalBars / BARS_PER_TACT)
  // Grid step: how many bars between each rendered tick/line.
  // Thins progressively so the grid stays visible at all bar counts
  // instead of disappearing entirely above a hard limit.
  // Steps are powers of 2 so lines land on musically meaningful boundaries.
  const barGridStep = !compact ? (() => {
    // Each threshold is 160 × 2^n — same base as the original 160-bar cutoff
    // but stepped progressively rather than cut off entirely.
    for (const [max, step] of [
      [160, 1], [320, 2], [640, 4], [1280, 8], [2560, 16], [5120, 32],
    ] as [number, number][]) {
      if (totalBars <= max) return step
    }
    return 64
  })() : 4  // compact always shows tact-level lines
  // Pick a label step so the ruler never shows more than ~14 labels.
  const tactLabelStep = (() => {
    for (const s of [1, 2, 4, 8, 16, 32, 64]) {
      if (tactCount / s <= 14) return s
    }
    return 64
  })()
  const showTactLabel = (tactIndex: number) =>
    compact ? tactIndex % 2 === 0 : tactIndex % tactLabelStep === 0

  const activeSection = activeEdit
    ? sections.find(s => s.id === activeEdit.sectionId)
    : undefined

  const playheadPct = totalDurationMs > 0
    ? Math.min(100, (currentTimeMs / totalDurationMs) * 100)
    : 0

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

  function ratioFromTimelineEl(clientX: number, el: HTMLElement): number {
    if (totalDurationMs <= 0) return 0
    const rect = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  function attachTimelineScrub(el: HTMLElement, clientX: number) {
    // Initial click — preview position immediately but don't rebuild audio graph yet.
    let pendingRatio = ratioFromTimelineEl(clientX, el)
    let rafId: number | null = null
    let latestClientX = clientX

    function onMove(ev: MouseEvent) {
      latestClientX = ev.clientX
      // Throttle to one rAF per frame — avoids saturating the main thread.
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        pendingRatio = ratioFromTimelineEl(latestClientX, el)
        // No onSeek here — only update visual preview.
      })
    }
    function onUp() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Commit seek ONCE on release — rebuilds audio graph exactly one time.
      onSeek((pendingRatio * totalDurationMs) / 1000)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleRulerMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!seekEnabled || totalDurationMs <= 0) return
    e.preventDefault()
    e.stopPropagation()
    attachTimelineScrub(e.currentTarget, e.clientX)
  }

  function handleStripMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!seekEnabled || selMode === 'naming' || resizeDragRef.current || newSectionDragRef.current) return
    e.preventDefault()

    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))

    // View mode — click anywhere on the strip to seek
    if (!editMode) {
      attachTimelineScrub(e.currentTarget, e.clientX)
      return
    }

    const bar = Math.max(0, Math.min(
      Math.floor(ratio * totalDurationMs / Math.max(barDurationMs, 1)),
      totalBars - 1
    ))

    // Edit mode — click on existing section to select
    const hit = sections.find(s => bar >= s.start_bar && bar < s.end_bar)
    if (hit) {
      const sLeft = rect.left + tp(hit.start_bar) * rect.width
      const sWidth = (tp(hit.end_bar) - tp(hit.start_bar)) * rect.width
      setActiveEdit({
        sectionId: hit.id,
        cellPos: { left: sLeft, top: rect.top, width: sWidth, height: rect.height },
      })
      return
    }

    if (activeEdit) return

    // Drag-to-create: start drag
    const dragStartBar = bar
    newSectionDragRef.current = { startBar: dragStartBar }
    document.body.style.userSelect = 'none'

    // Compute selection range from drag direction (snap outward to include partial bars)
    function computeSelection(startB: number, curB: number): [number, number] {
      return curB >= startB ? [startB, curB + 1] : [curB, startB + 1]
    }

    setSelStart(dragStartBar)
    setSelEnd(dragStartBar + 1)
    setHint({ text: `Bar ${dragStartBar + 1}`, isError: false })

    function onDragMove(ev: MouseEvent) {
      if (!newSectionDragRef.current) return
      const curBar = barFromClientX(ev.clientX)
      const [s, e] = computeSelection(dragStartBar, curBar)
      const overlap = sectionsRef.current.find(sec => s < sec.end_bar && e > sec.start_bar)
      setSelStart(s)
      setSelEnd(e)
      setHint(
        overlap
          ? { text: `Overlaps with "${sectionLabel(overlap)}"`, isError: true }
          : { text: `Bars ${s + 1}–${e} · ${e - s} bar${e - s !== 1 ? 's' : ''}`, isError: false },
      )
    }

    function onDragUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', onDragMove)
      window.removeEventListener('mouseup', onDragUp)
      document.body.style.userSelect = ''
      newSectionDragRef.current = null

      const curBar = barFromClientX(ev.clientX)
      const [s, e] = computeSelection(dragStartBar, curBar)
      const overlap = sectionsRef.current.find(sec => s < sec.end_bar && e > sec.start_bar)

      if (!overlap) {
        setSelStart(s)
        setSelEnd(e)
        setSelMode('naming')
        setHint(null)
      } else {
        resetSel()
      }
    }

    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragUp)
  }

  function openSectionEdit(section: Section) {
    const el = stripRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const sLeft = rect.left + tp(section.start_bar) * rect.width
    const sWidth = (tp(section.end_bar) - tp(section.start_bar)) * rect.width
    setActiveEdit({
      sectionId: section.id,
      cellPos: { left: sLeft, top: rect.top, width: sWidth, height: rect.height },
    })
  }

  async function runChordDetection(section: Section, selectedTrackIds: string[]) {
    if (selectedTrackIds.length === 0) return

    setDetectingChordsFor(section.id)
    try {
      const bpm = project.bpm ?? 120
      const timeSig = project.time_signature ?? '4/4'
      const totalSec = totalDurationMs / 1000
      const barDurSec = barDurationSec(bpm, timeSig)
      const barCount = sectionBarCount(section, totalBars)

      const buffer = await getMergedToneBuffer(
        tracks, bpm, timeSig, totalSec, selectedTrackIds,
      )
      if (!buffer) return

      const { startTimeSec, endTimeSec } = sectionTimeRangeSec(
        section.start_bar,
        section.start_bar + barCount,
        bpm,
        timeSig,
      )
      const slice = sliceSectionFromToneBuffer(buffer, startTimeSec, endTimeSec)
      if (slice.length === 0) return

      const detected = await detectChordsInAudio(slice, {
        sampleRate: buffer.sampleRate,
        barDurationSec: barDurSec,
        barCount,
      })
      if (!detected.trim()) return

      handleChordsLocalChange(section.id, detected)
      await handleChordsAutoSave(section.id, detected)
    } catch (err) {
      console.warn('[chordDetection]', err)
    } finally {
      setDetectingChordsFor(prev => (prev === section.id ? null : prev))
    }
  }

  function handleDetectChords(sectionId: string, selectedTrackIds: string[]) {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    trackEvent('chord_detect_clicked')
    void runChordDetection(section, selectedTrackIds)
  }

  async function handleConfirmNew(type: SectionType, customName?: string, chords?: string) {
    if (selStart === null || selEnd === null) return
    try {
      const res = await fetch(`/api/versions/${versionId}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, custom_name: customName ?? null,
          start_bar: selStart, end_bar: selEnd,
          chords: chords ?? null,
          color: SECTION_STORED_COLOR, position: sections.length,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const { section } = await res.json()
      onSectionsChange(prev =>
        [...prev, section].sort((a, b) => a.start_bar - b.start_bar),
      )
      requestAnimationFrame(() => {
        openSectionEdit(section)
      })
    } catch (err) {
      console.error(err)
    }
    resetSel()
  }

  function handleTypeChange(id: string, type: SectionType, customName?: string) {
    onSectionsChange(prev => prev.map(s =>
      s.id === id ? { ...s, type, custom_name: customName ?? null, color: SECTION_STORED_COLOR } : s,
    ))
    fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, custom_name: customName ?? null, color: SECTION_STORED_COLOR }),
    }).catch(console.error)
  }

  function handleChordsLocalChange(id: string, chords: string) {
    onSectionsChange(prev =>
      prev.map(s => (s.id === id ? { ...s, chords } : s)),
    )
    pendingChordSavesRef.current.set(id, chords)
    setPendingChordIds(prev => new Set(prev).add(id))
  }

  async function handleChordsAutoSave(id: string, chords: string): Promise<void> {
    const gen = (chordSaveGenRef.current.get(id) ?? 0) + 1
    chordSaveGenRef.current.set(id, gen)
    const res = await fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chords }),
    })
    if (!res.ok) throw new Error('Failed to save chords')
    if (chordSaveGenRef.current.get(id) !== gen) return
    onSectionsChange(prev => prev.map(s => (s.id === id ? { ...s, chords } : s)))
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
    try {
      await fetch(`/api/versions/${versionId}/structure/submit`, { method: 'POST' })
      trackEvent('structure_saved', { section_count: sections.length })
    } catch {
      // non-fatal
    }
    onEditModeChange(false)
  }

  const closeActiveEdit = useCallback(() => setActiveEdit(null), [])

  function handleDelete(id: string) {
    onSectionsChange(prev => prev.filter(s => s.id !== id))
    setActiveEdit(null)
    fetch(`/api/sections/${id}`, { method: 'DELETE' }).catch(console.error)
  }

  function handleBarRangeChange(id: string, startBar: number, endBar: number) {
    const sorted = [...sections].sort((a, b) => a.start_bar - b.start_bar)
    const idx = sorted.findIndex(s => s.id === id)
    const section = sorted[idx]
    if (!section) return

    const prev = idx > 0 ? sorted[idx - 1] : null
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null
    const minStart = prev ? prev.end_bar : 0
    const maxEnd = next ? next.start_bar : totalBars
    const start = Math.max(minStart, Math.min(startBar, endBar - 1))
    const end = Math.max(start + 1, Math.min(endBar, maxEnd))
    if (start === section.start_bar && end === section.end_bar) return

    onSectionsChange(prevSections =>
      prevSections
        .map(s => (s.id === id ? { ...s, start_bar: start, end_bar: end } : s))
        .sort((a, b) => a.start_bar - b.start_bar),
    )
    updateActiveEditPos(id, start, end)
    fetch(`/api/sections/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_bar: start, end_bar: end }),
    }).catch(console.error)
  }

  function handlePendingRangeChange(start: number, end: number) {
    const overlap = sections.find(s => start < s.end_bar && end > s.start_bar)
    if (overlap) {
      setHint({ text: `Overlaps with "${sectionLabel(overlap)}"`, isError: true })
      return
    }
    setSelStart(start)
    setSelEnd(end)
    setHint(null)
  }

  const stripCursor = !editMode
    ? 'pointer'
    : activeEdit ? 'default'
    : selMode === 'naming' ? 'default'
    : 'crosshair'

  return (
    <>
      <div className="bg-surface border-b border-border shrink-0 select-none">

        {editMode && !compact && (
          <div className="flex items-center gap-2 h-[34px] px-3 border-b border-border bg-surface/40">
            <span className="size-1.5 rounded-full bg-lime animate-pulse-dot shrink-0" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Structure</span>

            {hint ? (
              <span className={`text-[11px] flex-1 min-w-0 truncate ${hint.isError ? 'text-destructive' : 'text-lime'}`}>
                {hint.text}
              </span>
            ) : (
              <span className="text-[11px] flex-1 min-w-0 truncate text-muted-foreground">
                {sections.length === 0
                  ? 'Drag the strip to place your first section'
                  : `${sections.length} section${sections.length !== 1 ? 's' : ''} — drag to add · drag edges to resize`}
              </span>
            )}

            <div className="ml-auto flex gap-2 shrink-0">
              <TbButton variant="primary" onClick={handleDone} className="h-[26px] px-3.5">
                Done
              </TbButton>
            </div>
          </div>
        )}

        {/* Tacts + structure — separate rows, shared label column */}
        <div className="flex items-stretch border-b border-border">
          {/* Label column */}
          <div style={{ width: wl }} className="shrink-0 border-r border-border flex flex-col bg-surface/40">
            <div
              className={`border-b border-border px-3 flex items-center text-[9px] uppercase font-bold tracking-widest text-muted-foreground ${compact ? '' : 'flex-col justify-between'}`}
              style={{ height: RULER_H }}
            >
              <span className={compact ? '' : 'pt-2'}>CHANNEL</span>
              {!compact && (
                <span className="pb-1.5 normal-case tracking-normal font-mono text-foreground/60 font-normal">
                  {totalBars} bars · {project.time_signature ?? '4/4'}
                </span>
              )}
            </div>
            <div
              className={`px-3 flex items-center ${compact ? '' : 'flex-col justify-center gap-0.5'} ${editMode && !compact ? 'bg-lime-soft/30' : 'bg-lime-soft/40'}`}
              style={{ height: RIBBON_H }}
            >
              <div className="flex items-center gap-1.5 text-[9px] uppercase font-bold tracking-widest text-lime">
                {editMode && !compact && <span className="size-1.5 rounded-full bg-lime animate-pulse-dot shrink-0" />}
                STRUCTURE
              </div>
              {editMode && !compact && (
                <span className="text-[8px] normal-case tracking-normal font-mono text-muted-foreground">
                  drag to add · drag edges to resize
                </span>
              )}
            </div>
            {hasChords && (
              <div
                className="px-3 flex items-center justify-center bg-surface/40 border-t border-border"
                style={{ height: CHORDS_H }}
              >
                <span className="text-[9px] uppercase font-bold tracking-widest text-muted-foreground">Chords</span>
              </div>
            )}
          </div>

          {/* Timeline column — ruler + structure grid */}
          <div className="flex-1 min-w-0 relative flex flex-col bg-surface">
            {totalDurationMs > 0 && (
              <div
                className="absolute top-0 w-px -ml-px bg-foreground/70 pointer-events-none z-[15]"
                style={{ left: `${playheadPct}%`, height: RULER_H + RIBBON_H }}
              />
            )}

            {/* Tacts row — click/drag to seek */}
            <div
              onMouseDown={handleRulerMouseDown}
              className={`relative border-b border-border bg-surface/40 overflow-hidden select-none shrink-0 transition-colors ${
                seekEnabled ? 'cursor-pointer hover:bg-surface/60' : 'pointer-events-none'
              }`}
              style={{ height: RULER_H }}
              title={seekEnabled ? 'Click or drag to seek' : undefined}
            >
              {Array.from({ length: tactCount }, (_, i) => {
                if (!showTactLabel(i)) return null
                const bar = i * BARS_PER_TACT
                const barNum = bar + 1
                const heavy = compact ? true : i % 4 === 0
                return (
                  <span
                    key={`tact-num-${i}`}
                    className={`absolute top-0.5 text-[9px] tabular-nums font-mono pointer-events-none ${
                      heavy ? 'text-foreground font-medium' : 'text-muted-foreground/80'
                    }`}
                    style={{ left: `${tp(bar) * 100}%`, paddingLeft: i === 0 ? 2 : 4 }}
                  >
                    {heavy ? barNum : <span className="hidden sm:inline">{barNum}</span>}
                  </span>
                )
              })}
              {Array.from({ length: Math.ceil(totalBars / barGridStep) }, (_, idx) => {
                const i = idx * barGridStep
                const isTact = i % BARS_PER_TACT === 0
                return (
                  <div
                    key={`ruler-tick-${i}`}
                    className="absolute bottom-0 w-px pointer-events-none"
                    style={{
                      left: `${tp(i) * 100}%`,
                      height: isTact ? 12 : 6,
                      background: isTact ? 'color-mix(in oklab, var(--foreground) 45%, transparent)' : 'var(--border)',
                    }}
                  />
                )
              })}
            </div>

            {/* Structure row */}
            <div
              ref={stripRef}
              onMouseDown={handleStripMouseDown}
              className={`relative overflow-hidden shrink-0 ${editMode ? 'bg-lime-soft/30' : 'bg-lime-soft/40'}`}
              style={{ height: RIBBON_H, cursor: stripCursor }}
            >
              {Array.from({ length: Math.ceil(totalBars / barGridStep) }, (_, idx) => {
                const i = idx * barGridStep
                const isTact = i % BARS_PER_TACT === 0
                return (
                  <div
                    key={`strip-grid-${i}`}
                    className="absolute top-0 bottom-0 w-px pointer-events-none"
                    style={{
                      left: `${tp(i) * 100}%`,
                      background: isTact ? 'var(--border)' : 'color-mix(in oklab, var(--border) 55%, transparent)',
                      opacity: isTact ? 0.55 : 0.35,
                    }}
                  />
                )
              })}

              {sections.map(s => {
                const isActive = activeEdit?.sectionId === s.id
                const pendingChords = pendingChordIds.has(s.id)
                const accent = 'var(--lime)'
                const sideBorder = pendingChords
                  ? `1px solid color-mix(in oklab, ${accent} 40%, var(--border))`
                  : isActive
                    ? '1px solid color-mix(in oklab, var(--lime) 35%, var(--border))'
                    : '1px solid color-mix(in oklab, var(--border) 85%, var(--lime) 15%)'
                return (
                  <div
                    key={s.id}
                    data-structure-section
                    className={`absolute inset-y-0 flex items-center px-2 overflow-hidden transition-[filter] ${
                      editMode && !compact ? 'cursor-pointer hover:brightness-[1.03]' : 'cursor-inherit'
                    } ${isActive ? 'z-[8]' : 'z-[6]'}`}
                    style={{
                      left: `${tp(s.start_bar) * 100}%`,
                      width: `${(tp(s.end_bar) - tp(s.start_bar)) * 100}%`,
                      borderTop: 'none',
                      borderBottom: 'none',
                      borderLeft: sideBorder,
                      borderRight: sideBorder,
                      background: `color-mix(in oklab, ${accent} 12%, transparent)`,
                    }}
                  >
                    <span className={`tb-section-name uppercase tracking-widest text-lime truncate leading-tight pointer-events-none w-full ${compact ? 'text-[8px]' : 'text-[9px]'}`}>
                      {sectionLabel(s)}
                    </span>
                    {editMode && !compact && (
                      <>
                        <div
                          onMouseDown={e => beginResize(e, s.id, 'start')}
                          title="Drag to resize"
                          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-foreground/10"
                        />
                        <div
                          onMouseDown={e => beginResize(e, s.id, 'end')}
                          title="Drag to resize"
                          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize z-10 hover:bg-foreground/10"
                        />
                      </>
                    )}
                  </div>
                )
              })}

              {editMode && !compact && selStart !== null && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none border-x border-foreground/35 bg-foreground/[0.04]"
                  style={{
                    left: `${tp(selStart) * 100}%`,
                    width: selEnd !== null
                      ? `${(tp(selEnd) - tp(selStart)) * 100}%`
                      : 1,
                  }}
                />
              )}

              {editMode && !compact && sections.length === 0 && selMode === 'idle' && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground pointer-events-none">
                  click to place first section
                </div>
              )}
            </div>

            {hasChords && (
              <div
                className="relative shrink-0 border-t border-border bg-surface/30 flex items-stretch"
                style={{ minHeight: CHORDS_H }}
              >
                <ChordPlaybackRow
                  sections={sections}
                  currentTimeMs={currentTimeMs}
                  barDurationMs={barDurationMs}
                  compact={compact}
                  className="h-full w-full min-w-0"
                  currentTimeRef={currentTimeRef}
                  playing={playing}
                  onChordDurationChange={handlePlaybackChordDurationChange}
                />
              </div>
            )}
          </div>

          <div style={{ width: wr }} className="shrink-0 bg-surface/40 border-l border-border" />
        </div>

      </div>

      {/* Name picker portal */}
      {!compact && selMode === 'naming' && selStart !== null && selEnd !== null && (
        <NamePickerPortal
          selectionStart={selStart}
          selectionEnd={selEnd}
          totalBars={totalBars}
          barDurationMs={barDurationMs}
          totalDurationMs={totalDurationMs}
          stripRef={stripRef}
          onConfirm={handleConfirmNew}
          onCancel={resetSel}
          onRangeChange={handlePendingRangeChange}
        />
      )}

      {/* Section edit popover */}
      {!compact && activeSection && activeEdit && (
        <SectionEditPopover
          section={activeSection}
          cellPos={activeEdit.cellPos}
          detectingChords={detectingChordsFor === activeSection.id}
          audioTracks={audioTracks}
          totalBars={totalBars}
          onTypeChange={handleTypeChange}
          onChordsLocalChange={handleChordsLocalChange}
          onChordsAutoSave={handleChordsAutoSave}
          onDetectChords={ids => handleDetectChords(activeSection.id, ids)}
          onBarRangeChange={handleBarRangeChange}
          onDelete={handleDelete}
          onClose={closeActiveEdit}
        />
      )}

    </>
  )
}

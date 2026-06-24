'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChordDurationPicker } from '@/components/ChordDurationPicker'
import {
  filterChordInputChar,
  formatBarDuration,
  parseChordsString,
  serializeChords,
  type ParsedChord,
} from '@/lib/chords'

const CHORD_INPUT_KEY = 'chord-input'

function isTouchInputDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(hover: none), (pointer: coarse)').matches
  )
}

function ChordChip({
  chord,
  onClick,
  compact,
}: {
  chord: ParsedChord
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  compact?: boolean
}) {
  const size = compact ? 'size-7' : 'size-8'
  const showDuration = Math.abs(chord.duration - 1) >= 0.001

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${size} shrink-0 border border-border bg-surface flex flex-col items-center justify-center hover:border-foreground/40 transition`}
      title={showDuration ? `${chord.name} · ${formatBarDuration(chord.duration)} bars` : chord.name}
    >
      <span className={`font-bold leading-none ${compact ? 'text-[10px]' : 'text-[11px]'} text-foreground/90`}>
        {chord.name}
      </span>
      {showDuration && (
        <span className="text-[7px] font-mono text-muted-foreground leading-none mt-0.5">
          {formatBarDuration(chord.duration)}
        </span>
      )}
    </button>
  )
}

function InactiveInsertSlot({
  compact,
  disabled,
  onActivate,
}: {
  compact?: boolean
  disabled?: boolean
  onActivate: () => void
}) {
  const rowH = compact ? 'h-7' : 'h-8'

  return (
    <span className={`relative inline-block w-0 ${rowH} shrink-0 overflow-visible align-middle`}>
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={onActivate}
        aria-label="Place cursor here"
        className="absolute top-0 bottom-0 -left-1.5 -right-1.5 z-[1] disabled:pointer-events-none"
      />
    </span>
  )
}

export function ChordInput({
  value,
  onChange,
  disabled = false,
  placeholder = 'Type chords…',
  compact = false,
}: {
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  placeholder?: string
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const skipNextInputRef = useRef(false)
  const touchInputRef = useRef(false)
  const chordsRef = useRef<ParsedChord[]>([])
  const cursorIndexRef = useRef(0)
  const draftRef = useRef('')
  const [chords, setChords] = useState<ParsedChord[]>(() => parseChordsString(value))
  const [draft, setDraft] = useState('')
  const [cursorIndex, setCursorIndex] = useState(() => parseChordsString(value).length)
  const [durationPicker, setDurationPicker] = useState<{ index: number; rect: DOMRect } | null>(null)
  const lastEmittedRef = useRef(value)

  chordsRef.current = chords
  cursorIndexRef.current = cursorIndex
  draftRef.current = draft

  useEffect(() => {
    touchInputRef.current = isTouchInputDevice()
  }, [])

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value
      const parsed = parseChordsString(value)
      setChords(parsed)
      setDraft('')
      setCursorIndex(parsed.length)
    }
  }, [value])

  const emit = useCallback((next: ParsedChord[]) => {
    setChords(next)
    const serialized = serializeChords(next)
    lastEmittedRef.current = serialized
    onChange(serialized)
  }, [onChange])

  const focusCursor = useCallback((index: number) => {
    setCursorIndex(index)
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [])

  function commitDraft(nameOverride?: string) {
    const name = (nameOverride ?? draftRef.current).trim()
    if (!name || !/^[A-Za-z0-9#]+$/.test(name)) return

    const insertAt = cursorIndexRef.current
    const next = [
      ...chordsRef.current.slice(0, insertAt),
      { name, duration: 1 },
      ...chordsRef.current.slice(insertAt),
    ]

    if (touchInputRef.current) {
      // Move caret first so the focused input stays mounted; chip follows on next tick.
      setDraft('')
      setCursorIndex(insertAt + 1)
      queueMicrotask(() => emit(next))
      return
    }

    emit(next)
    setDraft('')
    setCursorIndex(insertAt + 1)
  }

  function pullChordAt(index: number) {
    if (index < 0 || index >= chordsRef.current.length) return
    const pulled = chordsRef.current[index]
    const next = chordsRef.current.filter((_, i) => i !== index)

    if (touchInputRef.current) {
      setCursorIndex(index)
      queueMicrotask(() => {
        emit(next)
        setDraft(pulled.name)
      })
      return
    }

    emit(next)
    setDraft(pulled.name)
    setCursorIndex(index)
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      skipNextInputRef.current = true
      commitDraft()
      return
    }

    if (e.key === 'Backspace' && draftRef.current === '') {
      e.preventDefault()
      if (cursorIndexRef.current > 0) pullChordAt(cursorIndexRef.current - 1)
      return
    }

    if (e.key === 'ArrowLeft' && draftRef.current === '' && cursorIndexRef.current > 0) {
      e.preventDefault()
      focusCursor(cursorIndexRef.current - 1)
      return
    }

    if (e.key === 'ArrowRight' && draftRef.current === '' && cursorIndexRef.current < chordsRef.current.length) {
      e.preventDefault()
      focusCursor(cursorIndexRef.current + 1)
      return
    }

    if (e.key === 'Escape') setDraft('')
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (skipNextInputRef.current) {
      skipNextInputRef.current = false
      return
    }
    const raw = e.target.value
    // Mobile soft keyboards insert space via onChange, not keydown.
    if (/\s/.test(raw)) {
      skipNextInputRef.current = true
      const name = raw.split(/\s/)[0].split('').map(filterChordInputChar).join('')
      if (name) commitDraft(name)
      else setDraft('')
      return
    }
    const filtered = raw.split('').map(filterChordInputChar).join('')
    setDraft(filtered)
  }

  function handleChipClick(index: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) return
    e.stopPropagation()
    setDurationPicker({ index, rect: e.currentTarget.getBoundingClientRect() })
  }

  function handleDurationSelect(duration: number) {
    if (durationPicker === null) return
    emit(chords.map((c, i) => (i === durationPicker.index ? { ...c, duration } : c)))
  }

  const showPlaceholder = chords.length === 0 && draft === '' && cursorIndex === 0
  const chipGap = compact ? 'mx-0.5' : 'mx-0.5'
  const rowH = compact ? 'h-7' : 'h-8'
  const widthCh = Math.max(2, draft.length + 1, showPlaceholder ? placeholder.length : 0)

  const inputEl = (
    <span key={CHORD_INPUT_KEY} className={`inline-flex ${rowH} items-center shrink-0 align-middle`}>
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (draftRef.current.trim()) commitDraft() }}
        placeholder={showPlaceholder ? placeholder : undefined}
        size={widthCh}
        className={`${rowH} p-0 m-0 bg-transparent focus:outline-none font-mono leading-none ${
          compact ? 'text-[10px]' : 'text-xs'
        }`}
        style={{ width: `${widthCh}ch` }}
      />
    </span>
  )

  const slotNodes: ReactNode[] = []
  for (let slot = 0; slot <= chords.length; slot++) {
    if (slot === cursorIndex) {
      slotNodes.push(inputEl)
    } else {
      slotNodes.push(
        <InactiveInsertSlot
          key={`slot-${slot}`}
          compact={compact}
          disabled={disabled}
          onActivate={() => focusCursor(slot)}
        />,
      )
    }
    if (slot < chords.length) {
      slotNodes.push(
        <span key={`chip-${slot}`} className={`inline-flex ${chipGap}`}>
          <ChordChip
            chord={chords[slot]}
            compact={compact}
            onClick={e => handleChipClick(slot, e)}
          />
        </span>,
      )
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center content-start border border-border bg-surface px-1.5 py-1 min-h-[34px] focus-within:border-foreground/40 transition ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={e => {
        if (disabled) return
        if (e.target === e.currentTarget) focusCursor(chords.length)
      }}
    >
      {slotNodes}

      {durationPicker !== null && (
        <ChordDurationPicker
          anchorRect={durationPicker.rect}
          currentDuration={chords[durationPicker.index]?.duration ?? 1}
          onSelect={handleDurationSelect}
          onClose={() => setDurationPicker(null)}
        />
      )}
    </div>
  )
}

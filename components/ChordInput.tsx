'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ChordDurationPicker } from '@/components/ChordDurationPicker'
import {
  filterChordInputChar,
  formatBarDuration,
  parseChordsString,
  serializeChords,
  type ParsedChord,
} from '@/lib/chords'

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

function InsertSlot({
  active,
  compact,
  disabled,
  draft,
  placeholder,
  inputRef,
  onDraftChange,
  onKeyDown,
  onBlur,
  onActivate,
}: {
  active: boolean
  compact?: boolean
  disabled?: boolean
  draft: string
  placeholder?: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onDraftChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
  onActivate: () => void
}) {
  const rowH = compact ? 'h-7' : 'h-8'

  if (active) {
    const widthCh = Math.max(2, draft.length + 1, placeholder?.length ?? 0)
    return (
      <span className={`inline-flex ${rowH} items-center shrink-0 align-middle`}>
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          onChange={onDraftChange}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          size={widthCh}
          className={`${rowH} p-0 m-0 bg-transparent focus:outline-none font-mono leading-none ${
            compact ? 'text-[10px]' : 'text-xs'
          }`}
          style={{ width: `${widthCh}ch` }}
        />
      </span>
    )
  }

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
  const [chords, setChords] = useState<ParsedChord[]>(() => parseChordsString(value))
  const [draft, setDraft] = useState('')
  const [cursorIndex, setCursorIndex] = useState(() => parseChordsString(value).length)
  const [durationPicker, setDurationPicker] = useState<{ index: number; rect: DOMRect } | null>(null)
  const lastEmittedRef = useRef(value)

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
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  function commitDraft() {
    const name = draft.trim()
    if (!name || !/^[A-Za-z0-9#]+$/.test(name)) return
    const next = [
      ...chords.slice(0, cursorIndex),
      { name, duration: 1 },
      ...chords.slice(cursorIndex),
    ]
    emit(next)
    setDraft('')
    setCursorIndex(cursorIndex + 1)
  }

  function pullChordAt(index: number) {
    if (index < 0 || index >= chords.length) return
    const pulled = chords[index]
    emit(chords.filter((_, i) => i !== index))
    setDraft(pulled.name)
    setCursorIndex(index)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
      return
    }

    if (e.key === 'Backspace' && draft === '') {
      e.preventDefault()
      if (cursorIndex > 0) pullChordAt(cursorIndex - 1)
      return
    }

    if (e.key === 'ArrowLeft' && draft === '' && cursorIndex > 0) {
      e.preventDefault()
      focusCursor(cursorIndex - 1)
      return
    }

    if (e.key === 'ArrowRight' && draft === '' && cursorIndex < chords.length) {
      e.preventDefault()
      focusCursor(cursorIndex + 1)
      return
    }

    if (e.key === 'Escape') setDraft('')
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const filtered = e.target.value.split('').map(filterChordInputChar).join('')
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
      <InsertSlot
        active={cursorIndex === 0}
        compact={compact}
        disabled={disabled}
        draft={draft}
        placeholder={showPlaceholder ? placeholder : undefined}
        inputRef={inputRef}
        onDraftChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (draft.trim()) commitDraft() }}
        onActivate={() => focusCursor(0)}
      />
      {chords.map((chord, i) => (
        <Fragment key={`${i}-${chord.name}`}>
          <span className={`inline-flex ${chipGap}`}>
            <ChordChip
              chord={chord}
              compact={compact}
              onClick={e => handleChipClick(i, e)}
            />
          </span>
          <InsertSlot
            active={cursorIndex === i + 1}
            compact={compact}
            disabled={disabled}
            draft={draft}
            inputRef={inputRef}
            onDraftChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onBlur={() => { if (draft.trim()) commitDraft() }}
            onActivate={() => focusCursor(i + 1)}
          />
        </Fragment>
      ))}

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

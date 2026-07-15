'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, Trash2, X } from 'lucide-react'
import { ChordDurationPicker } from '@/components/ChordDurationPicker'
import {
  filterChordInputChar,
  formatBarDuration,
  isValidChordName,
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

const LONG_PRESS_MS = 450

function ChordChip({
  chord,
  onClick,
  onContextMenu,
  onLongPress,
  selected,
  compact,
}: {
  chord: ParsedChord
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Touch devices — long-press toggles selection instead of opening the picker. */
  onLongPress?: () => void
  selected?: boolean
  compact?: boolean
}) {
  const showDuration = Math.abs(chord.duration - 1) >= 0.001
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const minSize = compact ? 'min-w-7 min-h-7' : 'min-w-8 min-h-8'

  return (
    <button
      type="button"
      onClick={e => {
        // Swallow the click synthesized after a long-press.
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false
          return
        }
        onClick(e)
      }}
      onContextMenu={onContextMenu}
      onTouchStart={onLongPress ? () => {
        longPressFiredRef.current = false
        clearLongPress()
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null
          longPressFiredRef.current = true
          navigator.vibrate?.(10)
          onLongPress()
        }, LONG_PRESS_MS)
      } : undefined}
      onTouchMove={onLongPress ? clearLongPress : undefined}
      onTouchEnd={onLongPress ? clearLongPress : undefined}
      onTouchCancel={onLongPress ? clearLongPress : undefined}
      // Shift-click toggles selection — suppress native text-selection artifacts.
      onMouseDown={e => { if (e.shiftKey) e.preventDefault() }}
      className={`inline-flex shrink-0 border flex-col items-center justify-center transition px-1.5 ${minSize} ${
        selected
          ? 'border-lime bg-lime text-primary-foreground'
          : 'border-border bg-surface hover:border-foreground/40'
      }`}
      title={showDuration ? `${chord.name} · ${formatBarDuration(chord.duration)} bars` : chord.name}
    >
      <span className={`font-bold leading-none whitespace-nowrap ${compact ? 'text-[10px]' : 'text-[11px]'} ${selected ? '' : 'text-foreground/90'}`}>
        {chord.name}
      </span>
      {showDuration && (
        <span className={`text-[7px] font-mono leading-none mt-0.5 ${selected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          {formatBarDuration(chord.duration)}
        </span>
      )}
    </button>
  )
}

/** Group sorted indices into contiguous runs, e.g. [2,4,5] → [[2],[4,5]]. */
function contiguousRuns(indices: number[]): number[][] {
  const runs: number[][] = []
  for (const i of indices) {
    const last = runs[runs.length - 1]
    if (last && i === last[last.length - 1] + 1) last.push(i)
    else runs.push([i])
  }
  return runs
}

function InactiveInsertSlot({
  compact,
  disabled,
  onActivate,
  style,
}: {
  compact?: boolean
  disabled?: boolean
  onActivate: () => void
  style?: React.CSSProperties
}) {
  const rowH = compact ? 'h-7' : 'h-8'

  return (
    <span
      className={`relative inline-block w-0 ${rowH} shrink-0 overflow-visible align-middle`}
      style={style}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onPointerDown={e => {
          e.preventDefault()
          if (!disabled) onActivate()
        }}
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
  const chipRefs = useRef<Map<number, HTMLElement>>(new Map())
  const skipNextInputRef = useRef(false)
  const committingRef = useRef(false)
  const touchInputRef = useRef(false)
  const chordsRef = useRef<ParsedChord[]>([])
  const cursorIndexRef = useRef(0)
  const draftRef = useRef('')
  const [chords, setChords] = useState<ParsedChord[]>(() => parseChordsString(value))
  const [draft, setDraft] = useState('')
  const [cursorIndex, setCursorIndex] = useState(() => parseChordsString(value).length)
  const [durationPicker, setDurationPicker] = useState<{ index: number; rect: DOMRect } | null>(null)
  // Desktop multi-select (shift+click) of chord chips.
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const selectedRef = useRef(selected)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const lastEmittedRef = useRef(value)

  chordsRef.current = chords
  cursorIndexRef.current = cursorIndex
  draftRef.current = draft
  selectedRef.current = selected

  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    const touch = isTouchInputDevice()
    touchInputRef.current = touch
    setIsTouch(touch)
  }, [])

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value
      const parsed = parseChordsString(value)
      setChords(parsed)
      setDraft('')
      setCursorIndex(parsed.length)
      setSelected(new Set())
      setContextMenu(null)
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
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  /**
   * Nearest gap for a click that landed on the container background (not on a chip
   * or an insert slot). Chips render in reading order (flex-wrap, ascending `order`),
   * so we count how many come before the click — earlier row, or same row and left
   * of the click — and insert there. Without this, background clicks between chords
   * always fell through to `chords.length`, snapping the caret to the end.
   */
  const insertIndexFromPoint = useCallback((x: number, y: number): number => {
    let insertAt = 0
    for (let i = 0; i < chordsRef.current.length; i++) {
      const el = chipRefs.current.get(i)
      if (!el) { insertAt = i + 1; continue }
      const r = el.getBoundingClientRect()
      let before: boolean
      if (r.bottom < y) before = true
      else if (r.top > y) before = false
      else before = x > r.left + r.width / 2
      if (before) insertAt = i + 1
      else break
    }
    return insertAt
  }, [])

  const deleteSelected = useCallback(() => {
    const sel = selectedRef.current
    if (sel.size === 0) return
    const next = chordsRef.current.filter((_, i) => !sel.has(i))
    const removedBefore = [...sel].filter(i => i < cursorIndexRef.current).length
    setSelected(new Set())
    setContextMenu(null)
    setCursorIndex(Math.max(0, cursorIndexRef.current - removedBefore))
    emit(next)
  }, [emit])

  /**
   * Duplicate each contiguous run of selected chords right after itself:
   * c1 c2 [C3] c4 [C5 C6] c7 → c1 c2 C3(×2) c4 C5 C6 C5 C6 c7.
   * A single-chord run just doubles its duration (equivalent, one chip).
   */
  const duplicateSelected = useCallback(() => {
    const sel = selectedRef.current
    if (sel.size === 0) return
    const src = chordsRef.current
    const runs = contiguousRuns([...sel].sort((a, b) => a - b))
    const next: ParsedChord[] = []
    const newSelected = new Set<number>()
    let i = 0
    let cursorShift = 0
    for (const run of runs) {
      while (i < run[0]) next.push(src[i++])
      if (run.length === 1) {
        const c = src[i++]
        newSelected.add(next.length)
        next.push({ ...c, duration: c.duration * 2 })
      } else {
        for (const idx of run) {
          newSelected.add(next.length)
          next.push(src[idx])
        }
        for (const idx of run) next.push({ ...src[idx] })
        i = run[run.length - 1] + 1
        if (run[run.length - 1] < cursorIndexRef.current) cursorShift += run.length
      }
    }
    while (i < src.length) next.push(src[i++])
    setSelected(newSelected)
    setContextMenu(null)
    setCursorIndex(cursorIndexRef.current + cursorShift)
    emit(next)
  }, [emit])

  // Selection shortcuts: Backspace/Delete removes, Ctrl/Cmd+D duplicates, Escape deselects.
  useEffect(() => {
    if (selected.size === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Typing a draft in the chord input — let Backspace edit the draft.
        if (e.target === inputRef.current && draftRef.current !== '') return
        e.preventDefault()
        deleteSelected()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.key === 'Escape') {
        // Deselect only — stop the popover's window-level Escape handler from closing it.
        e.stopPropagation()
        setSelected(new Set())
        setContextMenu(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, deleteSelected, duplicateSelected])

  // Close the context menu on any outside press.
  useEffect(() => {
    if (!contextMenu) return
    function onDown(e: MouseEvent) {
      const target = e.target
      if (target instanceof Element && target.closest('[data-chord-context-menu]')) return
      setContextMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [contextMenu])

  function commitDraft(nameOverride?: string) {
    const name = (nameOverride ?? draftRef.current).trim()
    if (!name || !isValidChordName(name)) return

    setSelected(new Set())
    const insertAt = cursorIndexRef.current
    const next = [
      ...chordsRef.current.slice(0, insertAt),
      { name, duration: 1 },
      ...chordsRef.current.slice(insertAt),
    ]

    if (touchInputRef.current) {
      // Keep draft text until after emit so the input width stays stable (avoids keyboard dismiss).
      committingRef.current = true
      setCursorIndex(insertAt + 1)
      queueMicrotask(() => {
        emit(next)
        setDraft('')
        committingRef.current = false
        inputRef.current?.focus({ preventScroll: true })
      })
      return
    }

    emit(next)
    setDraft('')
    setCursorIndex(insertAt + 1)
  }

  function pullChordAt(index: number) {
    if (index < 0 || index >= chordsRef.current.length) return
    setSelected(new Set())
    const pulled = chordsRef.current[index]
    const next = chordsRef.current.filter((_, i) => i !== index)

    if (touchInputRef.current) {
      committingRef.current = true
      setCursorIndex(index)
      queueMicrotask(() => {
        emit(next)
        setDraft(pulled.name)
        committingRef.current = false
        inputRef.current?.focus({ preventScroll: true })
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
      // preventDefault stops onChange on some browsers; clear the skip flag so the
      // next chord's first character is not swallowed.
      queueMicrotask(() => {
        skipNextInputRef.current = false
      })
      return
    }

    if (e.key === 'Backspace' && draftRef.current === '') {
      // With an active selection the document-level handler deletes it instead.
      if (selectedRef.current.size > 0) return
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
    if (e.shiftKey) {
      // Shift implies a keyboard — no touch-device gate (touch-capable laptops
      // report maxTouchPoints > 0 and were wrongly excluded before).
      toggleSelect(index)
      return
    }
    if (selectedRef.current.size > 0) setSelected(new Set())
    setDurationPicker({ index, rect: e.currentTarget.getBoundingClientRect() })
  }

  function toggleSelect(index: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
    setContextMenu(null)
  }

  function handleChipContextMenu(index: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) return
    if (touchInputRef.current) {
      // Android long-press fires contextmenu — our long-press handler owns it.
      e.preventDefault()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    // Right-click outside the selection re-targets it to that chip.
    if (!selectedRef.current.has(index)) setSelected(new Set([index]))
    setContextMenu({ x: e.clientX, y: e.clientY })
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
    <span
      key={CHORD_INPUT_KEY}
      className={`inline-flex ${rowH} items-center shrink-0 align-middle`}
      style={{ order: cursorIndex * 2 }}
    >
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (committingRef.current) return
          if (draftRef.current.trim()) commitDraft()
        }}
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
    if (slot !== cursorIndex) {
      slotNodes.push(
        <InactiveInsertSlot
          key={`slot-${slot}`}
          compact={compact}
          disabled={disabled}
          onActivate={() => focusCursor(slot)}
          style={{ order: slot * 2 }}
        />,
      )
    }
    if (slot < chords.length) {
      slotNodes.push(
        <span
          key={`chip-${slot}`}
          ref={el => {
            if (el) chipRefs.current.set(slot, el)
            else chipRefs.current.delete(slot)
          }}
          className={`inline-flex ${chipGap}`}
          style={{ order: slot * 2 + 1 }}
        >
          <ChordChip
            chord={chords[slot]}
            compact={compact}
            selected={selected.has(slot)}
            onClick={e => handleChipClick(slot, e)}
            onContextMenu={e => handleChipContextMenu(slot, e)}
            onLongPress={isTouch && !disabled ? () => toggleSelect(slot) : undefined}
          />
        </span>,
      )
    }
  }
  slotNodes.push(inputEl)

  return (
    <>
      <div
        className={`flex flex-wrap items-center content-start border border-border bg-surface px-1.5 py-1 min-h-[34px] focus-within:border-foreground/40 transition ${
          disabled ? 'opacity-50 pointer-events-none' : ''
        }`}
        onClick={e => {
          if (disabled) return
          if (e.target === e.currentTarget) focusCursor(insertIndexFromPoint(e.clientX, e.clientY))
        }}
      >
        {slotNodes}
      </div>

      {/* Selection tip / actions */}
      {!disabled && (
        selected.size > 0 ? (
          isTouch ? (
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[9px] text-muted-foreground font-mono mr-auto">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={duplicateSelected}
                aria-label="Duplicate selected chords"
                className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-widest hover:border-foreground/40"
              >
                <Copy className="size-3" /> Duplicate
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                aria-label="Delete selected chords"
                className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-destructive hover:border-destructive/60"
              >
                <Trash2 className="size-3" /> Delete
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="inline-flex items-center border border-border p-1 hover:border-foreground/40"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <div className="mt-1 text-[9px] text-muted-foreground font-mono">
              {selected.size} selected · ⌘/Ctrl+D duplicate · ⌫ delete
            </div>
          )
        ) : (
          <div className="mt-1 text-[9px] text-muted-foreground font-mono">
            {isTouch ? 'Long-press a chord to select' : 'Shift+click chords to select'}
          </div>
        )
      )}

      {contextMenu !== null && selected.size > 0 && (
        <div
          data-chord-context-menu
          className="fixed z-[300] min-w-[140px] border border-border bg-popover shadow-2xl py-1"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={duplicateSelected}
            className="block w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-surface"
          >
            Duplicate <span className="text-muted-foreground text-[9px]">⌘D</span>
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="block w-full text-left px-3 py-1.5 text-[11px] font-mono text-destructive hover:bg-surface"
          >
            Delete <span className="text-muted-foreground text-[9px]">⌫</span>
          </button>
        </div>
      )}

      {durationPicker !== null && (
        <ChordDurationPicker
          anchorRect={durationPicker.rect}
          currentDuration={chords[durationPicker.index]?.duration ?? 1}
          onSelect={handleDurationSelect}
          onClose={() => setDurationPicker(null)}
        />
      )}
    </>
  )
}

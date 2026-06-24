'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DURATION_PRESETS, parseBarDuration } from '@/lib/chords'

export function ChordDurationPicker({
  anchorRect,
  currentDuration,
  onSelect,
  onClose,
}: {
  anchorRect: DOMRect
  currentDuration: number
  onSelect: (duration: number) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customVal, setCustomVal] = useState('')
  const customRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (customMode) customRef.current?.focus()
  }, [customMode])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const W = 160
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - W - 8))
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - 180)

  function isActivePreset(preset: string): boolean {
    const d = parseBarDuration(preset)
    return d !== null && Math.abs(d - currentDuration) < 0.001
  }

  function handleCustomSubmit() {
    const d = parseBarDuration(customVal)
    if (d !== null) {
      onSelect(d)
      onClose()
    }
  }

  return createPortal(
    <div
      ref={ref}
      data-chord-duration-picker
      className="fixed z-[250] border border-border bg-popover shadow-2xl p-2 animate-slide-in"
      style={{ top, left, width: W }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="text-[8px] uppercase tracking-widest text-muted-foreground mb-1.5 px-0.5">
        Duration (bars)
      </div>
      <div className="grid grid-cols-3 gap-1">
        {DURATION_PRESETS.map(preset => (
          <button
            key={preset}
            type="button"
            onClick={() => { onSelect(parseBarDuration(preset)!); onClose() }}
            className={`text-[10px] font-mono py-1 border transition ${
              isActivePreset(preset)
                ? 'border-ember text-ember bg-ember-soft/40'
                : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
            }`}
          >
            {preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className="text-[9px] uppercase tracking-widest py-1 border border-border text-muted-foreground hover:border-foreground/40 col-span-3"
        >
          Custom
        </button>
      </div>
      {customMode && (
        <div className="mt-2 flex gap-1">
          <input
            ref={customRef}
            value={customVal}
            onChange={e => setCustomVal(e.target.value.replace(/[^\d./]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCustomSubmit()
              if (e.key === 'Escape') setCustomMode(false)
            }}
            placeholder="e.g. 3/2"
            className="flex-1 bg-surface border border-border px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-foreground/40 min-w-0"
          />
          <button
            type="button"
            onClick={handleCustomSubmit}
            disabled={parseBarDuration(customVal) === null}
            className="text-[9px] uppercase tracking-widest border border-border px-2 py-1 disabled:opacity-40"
          >
            Set
          </button>
        </div>
      )}
    </div>,
    document.body,
  )
}

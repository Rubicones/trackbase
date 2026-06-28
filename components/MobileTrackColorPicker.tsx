'use client'

import { useEffect, useRef, useState } from 'react'
import { getTrackIconSwatches } from '@/lib/trackIcon'

export function MobileTrackColorPicker({
  trackId, initialColor, badgeLetter, onApply, onClose,
}: {
  trackId: string
  initialColor: string
  badgeLetter: string
  onApply: (color: string) => void
  onClose: () => void
}) {
  const [color, setColor] = useState(initialColor)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const swatches = getTrackIconSwatches()

  useEffect(() => {
    setColor(initialColor)
  }, [initialColor, trackId])

  useEffect(() => {
    function handler(e: MouseEvent | TouchEvent) {
      const target = ('touches' in e
        ? document.elementFromPoint(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0)
        : e.target) as Node | null
      if (ref.current && target && !ref.current.contains(target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose])

  async function handleApply() {
    setSaving(true)
    try {
      await fetch(`/api/tracks/${trackId}/icon`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icon_color: color }),
      })
      onApply(color)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <div
        ref={ref}
        className="fixed inset-x-3 bottom-3 z-[61] border border-border bg-popover p-4 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 m-0">Track color</p>
        <div className="flex flex-col gap-2 mb-4 w-full">
          {[0, 5].map(rowStart => (
            <div key={rowStart} className="grid grid-cols-5 gap-2 w-full">
              {swatches.slice(rowStart, rowStart + 5).map(c => {
                const selected = color === c
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-14 w-full rounded-sm ${
                      selected
                        ? 'ring-2 ring-lime ring-offset-2 ring-offset-popover'
                        : 'border border-border/40'
                    }`}
                    style={{ background: c }}
                    aria-label={`Color ${c}`}
                    aria-pressed={selected}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <div
            className="size-7 grid place-items-center text-[10px] font-bold text-background uppercase shrink-0"
            style={{ background: color }}
          >
            {badgeLetter}
          </div>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Preview</span>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] uppercase tracking-widest border border-border px-3 py-1.5 text-muted-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleApply() }}
            disabled={saving}
            className="text-[10px] uppercase tracking-widest border border-foreground bg-foreground text-background px-3 py-1.5 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </>
  )
}

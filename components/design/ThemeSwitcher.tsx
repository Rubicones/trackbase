'use client'

import { useEffect, useRef, useState } from 'react'
import { DESIGN_THEMES, useDesignTheme } from '@/lib/design-theme'

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useDesignTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = DESIGN_THEMES.find(t => t.id === theme) ?? DESIGN_THEMES[0]

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-border bg-surface/40 px-2 py-1.5 text-[10px] uppercase tracking-widest hover:border-lime hover:text-lime transition"
        aria-label="Switch theme"
        title={`Theme: ${current.label}`}
      >
        <span className="flex gap-px">
          {current.swatches.map((c, i) => (
            <span key={i} className="size-2 border border-border/40" style={{ background: c }} />
          ))}
        </span>
        {!compact && <span className="hidden sm:inline">{current.label}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 border border-border bg-popover shadow-2xl">
          <div className="px-3 py-2 border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">
            Theme
          </div>
          <div className="divide-y divide-border">
            {DESIGN_THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTheme(t.id)
                  setOpen(false)
                }}
                className={`w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-surface transition ${
                  t.id === theme ? 'bg-lime-soft' : ''
                }`}
              >
                <div className="flex flex-col gap-px shrink-0">
                  {[0, 2].map(row => (
                    <div key={row} className="flex gap-px">
                      {t.swatches.slice(row, row + 2).map((c, i) => (
                        <span key={i} className="size-3 border border-border/40" style={{ background: c }} />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-foreground">
                    {t.label}
                    {t.id === theme && <span className="text-lime">●</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

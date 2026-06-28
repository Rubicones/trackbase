'use client'

import { DESIGN_THEMES, useDesignTheme } from '@/lib/design-theme'

export function ThemePicker() {
  const { theme, setTheme } = useDesignTheme()

  return (
    <div className="divide-y divide-border">
      {DESIGN_THEMES.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          className={`w-full text-left flex items-start gap-3 px-3 py-2.5 font-mono hover:bg-surface transition ${
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
  )
}

'use client'

import type { ReactNode } from 'react'
import { useDesignTheme, DESIGN_THEMES } from '@/lib/design-theme'

export function UikitRoot({ children }: { children: ReactNode }) {
  const { theme } = useDesignTheme()
  return (
    <div className="tb-kit min-h-screen flex flex-col" data-theme={theme}>
      {children}
    </div>
  )
}

export function PageTag({ children }: { children: ReactNode }) {
  return (
    <div className="inline-block border border-lime/40 bg-lime-soft px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-lime">
      {children}
    </div>
  )
}

export function Section({ title, tag, id, children }: { title: string; tag: string; id: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32">
      <div className="flex items-baseline justify-between border-b border-border pb-2 mb-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-mono tracking-widest text-lime">{tag}</span>
          <h2 className="tb-section-title">{title}</h2>
        </div>
        <a href={`#${id}`} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime">#{id}</a>
      </div>
      <div>{children}</div>
    </section>
  )
}

export function Tile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border border-border bg-surface/30 p-4 ${className}`}>{children}</div>
}

export function Caption({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-normal ${className}`}>
      {children}
    </div>
  )
}

export function ActiveTheme() {
  const { theme } = useDesignTheme()
  const t = DESIGN_THEMES.find(x => x.id === theme) ?? DESIGN_THEMES[0]
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-px">
        {t.swatches.map((c, i) => (
          <span key={i} className="size-4 border border-border/40" style={{ background: c }} />
        ))}
      </div>
      <div className="text-xs font-bold uppercase tracking-widest font-mono">{t.label}</div>
    </div>
  )
}

export function ThemeMatrix() {
  const { theme, setTheme } = useDesignTheme()
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {DESIGN_THEMES.map(t => {
        const active = t.id === theme
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={`text-left border p-4 transition ${active ? 'border-lime bg-lime-soft' : 'border-border hover:border-lime'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="tb-type-name text-lg uppercase tracking-tight">{t.label}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{t.mode} · {t.id}</div>
              </div>
              {active && <span className="text-[10px] uppercase tracking-widest text-lime">● ACTIVE</span>}
            </div>
            <div className="mt-3 flex gap-1">
              {t.swatches.map((c, i) => (
                <span key={i} className="flex-1 h-12 border border-border/40" style={{ background: c }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{t.description}</p>
          </button>
        )
      })}
    </div>
  )
}

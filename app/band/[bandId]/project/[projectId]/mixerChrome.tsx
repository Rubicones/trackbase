'use client'

// Small presentational mixer controls — extracted verbatim from page.tsx.
import React, { memo, type ReactNode } from 'react'
import { HoverTooltip } from '@/components/design/HoverTooltip'

// ─── Uikit buttons ────────────────────────────────────────────────────────────

export function TbBtn({
  children,
  variant = 'ghost',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'solid'
}) {
  const base = 'text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5'
  const styles = {
    ghost: 'border border-border text-muted-foreground hover:border-lime hover:text-lime px-3 py-1.5',
    primary: 'bg-lime text-primary-foreground border border-lime px-3 py-1.5 font-display font-bold',
    solid: 'bg-foreground text-background px-3 py-1.5 font-bold hover:bg-lime',
  }
  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function MixerToolbarSeparator() {
  return (
    <div className="flex items-center self-center shrink-0" aria-hidden>
      <div className="w-px h-5 bg-border" />
    </div>
  )
}

export function MixerToolbarGroup({
  label,
  children,
  className = '',
  padX = 'px-3',
}: {
  label: string
  children: ReactNode
  className?: string
  padX?: string
}) {
  return (
    <div className={`flex flex-col gap-1 py-2 shrink-0 ${padX} ${className}`}>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground leading-none">
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
        {children}
      </div>
    </div>
  )
}
// ─── Track letter buttons ─────────────────────────────────────────────────────

export function TrackLetterBtn({
  letter, tooltip, active, onClick, activeClass, disabled = false,
}: {
  letter: string
  tooltip: string
  active?: boolean
  onClick?: () => void
  activeClass?: string
  disabled?: boolean
}) {
  return (
    <HoverTooltip label={tooltip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`size-5 border text-[9px] font-medium grid place-items-center transition uppercase disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active && activeClass ? activeClass : 'border-border hover:border-lime hover:text-lime text-muted-foreground'
        }`}
      >
        {letter}
      </button>
    </HoverTooltip>
  )
}

// ─── Action button ────────────────────────────────────────────────────────────

export function ActionButton({
  label, onClick, href, tooltip, danger,
}: {
  label: string
  onClick?: () => void
  href?: string
  tooltip: string
  danger?: boolean
}) {
  const className = `size-5 border text-[9px] font-medium grid place-items-center transition uppercase ${
    danger
      ? 'border-border text-muted-foreground hover:border-destructive hover:text-destructive hover:bg-destructive/10'
      : 'border-border text-muted-foreground hover:border-lime hover:text-lime hover:bg-lime-soft'
  }`

  return (
    <HoverTooltip label={tooltip} className="shrink-0">
      {href ? (
        <a href={href} download className={className}>{label}</a>
      ) : (
        <button type="button" onClick={onClick} className={className}>{label}</button>
      )}
    </HoverTooltip>
  )
}
export function ReplaceIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function DownloadIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 21h14" strokeLinecap="round" />
    </svg>
  )
}

export function TrashIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4h8v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
// ─── Master player (bottom bar) ───────────────────────────────────────────────

export const TransportToggle = memo(function TransportToggle({
  label, active, onClick, tooltip, disabled = false,
}: { label: string; active: boolean; onClick: () => void; tooltip: string; disabled?: boolean }) {
  return (
    <HoverTooltip label={tooltip} className="shrink-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip}
        className={`h-7 px-2 border text-[9px] font-bold uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground ${
          active
            ? 'border-lime bg-lime text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
        }`}
      >
        {label}
      </button>
    </HoverTooltip>
  )
})

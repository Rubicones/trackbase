'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import { Spinner } from '@/components/ui/Spinner'

export function AuthFieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground"
    >
      {children}
    </label>
  )
}

export function AuthInput({
  status,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  status?: 'idle' | 'checking' | 'valid' | 'invalid'
}) {
  const border =
    status === 'valid'
      ? 'border-online focus:border-online'
      : status === 'invalid'
        ? 'border-destructive focus:border-destructive'
        : 'border-border focus:border-lime'

  return (
    <input
      {...props}
      className={[
        'w-full h-9 bg-background border px-3 text-sm text-foreground outline-none transition-colors',
        'placeholder:text-muted-foreground/60',
        border,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}

export function AuthInputStatus({ status }: { status: 'checking' | 'valid' | 'invalid' }) {
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
      {status === 'checking' && <Spinner size={14} tone="muted" />}
      {status === 'valid' && <span className="text-online text-xs font-bold">✓</span>}
      {status === 'invalid' && <span className="text-destructive text-xs font-bold">✗</span>}
    </div>
  )
}

export function AuthButton({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'link'
}) {
  const monoBase =
    'w-full text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none'
  const accentBase =
    'w-full tb-btn-accent text-[10px] uppercase transition disabled:opacity-50 disabled:pointer-events-none'
  const styles = {
    primary:
      'bg-lime text-primary-foreground border border-lime px-4 py-2.5',
    ghost:
      'border border-border text-muted-foreground hover:border-lime hover:text-lime px-4 py-2.5',
    link: 'text-muted-foreground hover:text-lime underline underline-offset-2 bg-transparent border-0 py-1',
  }

  const base = variant === 'primary' ? accentBase : monoBase

  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function AuthHint({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <p
      className={`m-0 text-[11px] leading-relaxed ${error ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {children}
    </p>
  )
}

export function AuthDivider() {
  return <div className="h-px w-full bg-border my-1" />
}

export function AuthSteps({ current, total = 2 }: { current: number; total?: number }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={[
                'size-6 flex items-center justify-center text-[10px] font-bold border transition-colors',
                done || active
                  ? 'bg-lime border-lime text-primary-foreground'
                  : 'bg-background border-border text-muted-foreground',
              ].join(' ')}
            >
              {done ? '✓' : step}
            </div>
            {step < total && (
              <div
                className={`w-6 h-px ${done ? 'bg-lime' : 'bg-border'}`}
              />
            )}
          </div>
        )
      })}
      <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground">
        Step {current} of {total}
      </span>
    </div>
  )
}

export function AuthModeCard({
  selected,
  onClick,
  icon,
  title,
  description,
  accent = 'lime',
}: {
  selected: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  description: string
  accent?: 'lime' | 'online'
}) {
  const accentClass = accent === 'online' ? 'border-online bg-online/5' : 'border-lime bg-lime-soft/40'

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 p-4 border text-left transition-colors flex flex-col gap-2 min-w-0',
        selected ? accentClass : 'border-border bg-background hover:border-muted-foreground/40',
      ].join(' ')}
    >
      <span className={`text-2xl leading-none ${accent === 'online' ? 'text-online' : 'text-lime'}`}>
        {icon}
      </span>
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
    </button>
  )
}


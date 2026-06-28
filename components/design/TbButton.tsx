import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type TbButtonVariant = 'ghost' | 'primary' | 'danger' | 'solid' | 'menuDanger' | 'link'

const shell =
  'inline-flex items-center justify-center gap-1.5 text-[10px] uppercase transition-[transform,opacity] disabled:opacity-50 disabled:pointer-events-none'

const monoType = 'tracking-widest'

const variantClass: Record<TbButtonVariant, string> = {
  ghost: 'border border-border text-muted-foreground hover:border-lime hover:text-lime px-3 py-1.5',
  primary: 'tb-btn-accent bg-lime text-primary-foreground border border-lime px-3 py-1.5',
  solid: 'bg-foreground text-background px-3 py-1.5 font-bold hover:bg-lime hover:text-primary-foreground transition-colors border border-transparent',
  danger: 'bg-destructive text-destructive-foreground px-3 py-1.5 font-bold border border-transparent',
  menuDanger: 'border border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/10 px-3 py-1.5',
  link: 'border-0 text-muted-foreground hover:text-lime px-2 py-1 bg-transparent',
}

export function TbButton({
  children,
  variant = 'ghost',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TbButtonVariant
  children?: ReactNode
}) {
  const typeClass = variant === 'primary' ? '' : monoType
  return (
    <button type={type} className={`${shell} ${typeClass} ${variantClass[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

const menuButtonGhost =
  'border-x-0 border-t-0 border-b border-border text-muted-foreground hover:text-lime hover:bg-surface px-3 py-2 rounded-none last:border-b-0'
const menuButtonDanger =
  'border-0 text-destructive hover:bg-destructive/10 px-3 py-2 rounded-none'

export function tbMenuButtonClassName({
  danger = false,
  active = false,
  className = '',
}: {
  danger?: boolean
  active?: boolean
  className?: string
} = {}) {
  const base = 'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none'
  const variant = danger ? menuButtonDanger : menuButtonGhost
  return `${base} ${variant} w-full text-left ${active ? 'text-lime bg-surface' : ''} ${className}`.trim()
}

export function TbMenuButton({
  children,
  danger = false,
  active = false,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean
  active?: boolean
  children?: ReactNode
}) {
  return (
    <button
      type={type}
      className={tbMenuButtonClassName({ danger, active, className })}
      {...props}
    >
      {children}
    </button>
  )
}

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type TbButtonVariant = 'ghost' | 'primary' | 'danger' | 'solid' | 'menuDanger' | 'link'

const variantClass: Record<TbButtonVariant, string> = {
  ghost: 'border border-border text-muted-foreground hover:border-ember hover:text-ember px-3 py-1.5',
  primary: 'bg-ember text-white border border-ember px-3 py-1.5 font-bold hover:brightness-110',
  solid: 'bg-foreground text-background px-3 py-1.5 font-bold uppercase hover:bg-ember transition-colors border border-transparent',
  danger: 'bg-destructive text-destructive-foreground px-3 py-1.5 font-bold border border-transparent',
  menuDanger: 'border border-destructive/30 text-destructive hover:border-destructive hover:bg-destructive/10 px-3 py-1.5',
  link: 'border-0 text-muted-foreground hover:text-ember px-2 py-1 bg-transparent',
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
  const base = 'inline-flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none'
  return (
    <button type={type} className={`${base} ${variantClass[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

const menuButtonGhost =
  'border-x-0 border-t-0 border-b border-border text-muted-foreground hover:text-ember hover:bg-surface px-3 py-2 rounded-none last:border-b-0'
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
  return `${base} ${variant} w-full text-left ${active ? 'text-ember bg-surface' : ''} ${className}`.trim()
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

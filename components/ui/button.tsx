import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const fontClass: Record<ButtonVariant, string> = {
  default: 'font-display font-bold',
  secondary: 'font-mono font-medium',
  outline: 'font-mono font-medium',
  ghost: 'font-mono font-medium',
  destructive: 'font-mono font-medium',
  link: 'font-mono font-medium',
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:opacity-80',
  outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-surface hover:text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  link: 'text-primary underline-offset-4 hover:underline',
}

const sizeClass: Record<ButtonSize, string> = {
  default: 'h-9 px-4 py-2 text-sm',
  sm: 'h-8 px-3 text-xs',
  lg: 'h-10 px-8 text-sm',
  icon: 'h-9 w-9',
}

export function Button({
  children,
  variant = 'default',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-sm transition-[transform,colors,opacity] disabled:pointer-events-none disabled:opacity-50 ${fontClass[variant]} ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

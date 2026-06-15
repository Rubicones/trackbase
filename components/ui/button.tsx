import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon'

const variantClass: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
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
      className={`inline-flex items-center justify-center gap-2 font-mono font-medium rounded-sm transition-colors disabled:pointer-events-none disabled:opacity-50 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

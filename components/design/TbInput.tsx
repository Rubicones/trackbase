import type { InputHTMLAttributes } from 'react'

export function TbInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-ember placeholder:text-muted-foreground/60 disabled:opacity-50 ${className}`}
    />
  )
}

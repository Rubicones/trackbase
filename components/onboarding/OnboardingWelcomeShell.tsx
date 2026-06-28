'use client'

import type { ReactNode } from 'react'
import { TbButton } from '@/components/design/TbButton'
import { TbModal } from '@/components/design/TbModal'

export function WelcomeListItem({ label, desc }: { label: string; desc: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-muted-foreground">
      <span className="size-1 bg-lime shrink-0 mt-2" aria-hidden />
      <span>
        <span className="text-foreground font-medium uppercase text-[11px] tracking-wide">{label}</span>
        {' — '}
        {desc}
      </span>
    </li>
  )
}

export function OnboardingWelcomeShell({
  icon,
  title,
  children,
  onDismiss,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  onDismiss: () => void
}) {
  return (
    <TbModal onClose={onDismiss} wide>
      <div className="size-12 border border-border grid place-items-center text-lime mb-4 shrink-0">
        {icon}
      </div>
      <h2 className="font-display text-lg uppercase tracking-tight text-foreground m-0 mb-3">
        {title}
      </h2>
      {children}
      <TbButton variant="primary" className="w-full mt-6" onClick={onDismiss}>
        Got it
      </TbButton>
    </TbModal>
  )
}

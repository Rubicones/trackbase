'use client'

import { OnboardingWelcomeShell } from './OnboardingWelcomeShell'

interface Props {
  onDismiss: () => void
}

export function DashboardWelcomeModal({ onDismiss }: Props) {
  return (
    <OnboardingWelcomeShell
      icon={<FoldersIcon />}
      title="Welcome to sonicdesk."
      onDismiss={onDismiss}
    >
      <p className="text-sm text-muted-foreground leading-relaxed m-0">
        This is your bands page. Each band is a space for your group — projects, members, and
        activity all live here. Create a band to get started, or join one with an invite code.
      </p>
    </OnboardingWelcomeShell>
  )
}

function FoldersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 11h18" strokeOpacity="0.4" />
    </svg>
  )
}

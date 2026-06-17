'use client'

import { OnboardingWelcomeShell, WelcomeListItem } from './OnboardingWelcomeShell'

interface Props {
  onDismiss: () => void
}

export function BandWelcomeModal({ onDismiss }: Props) {
  return (
    <OnboardingWelcomeShell
      icon={<MusicIcon />}
      title="Your band's dashboard"
      onDismiss={onDismiss}
    >
      <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-4">
        Here&rsquo;s where your band lives. You&rsquo;ll find:
      </p>
      <ul className="m-0 p-0 list-none flex flex-col gap-2 mb-4">
        <WelcomeListItem label="Projects" desc="your songs and demos, each with full version history" />
        <WelcomeListItem label="Members" desc="everyone in the band, with their roles" />
        <WelcomeListItem label="Activity" desc="what's been happening recently" />
        <WelcomeListItem label="Storage" desc="how much space your band is using" />
      </ul>
      <p className="text-sm text-muted-foreground leading-relaxed m-0">
        Open a project to start uploading tracks, or create a new one.
      </p>
    </OnboardingWelcomeShell>
  )
}

function MusicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

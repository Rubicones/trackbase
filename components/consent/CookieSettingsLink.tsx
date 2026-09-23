'use client'

import { useConsent } from '@/components/consent/ConsentProvider'

/** Footer control that re-opens the cookie banner. */
export function CookieSettingsLink({ className = '' }: { className?: string }) {
  const { openSettings } = useConsent()
  return (
    <button type="button" onClick={openSettings} className={className}>
      Cookie settings
    </button>
  )
}

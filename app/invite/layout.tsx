import type { ReactNode } from 'react'
import { noIndexMetadata } from '@/lib/seo'

// Legacy invite-link redirect (client-rendered, forwards to /onboarding). It
// was previously indexable (inherited the homepage title/description from
// root layout) — noindex it like the other authenticated/utility routes.
export const metadata = noIndexMetadata('Invite')

export default function InviteLayout({ children }: { children: ReactNode }) {
  return children
}

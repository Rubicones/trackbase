import type { ReactNode } from 'react'
import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata('Onboarding')

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return children
}

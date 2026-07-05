import type { ReactNode } from 'react'
import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata(
  'Sign in',
  'Sign in to sonicdesk to access your band workspace.',
)

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children
}

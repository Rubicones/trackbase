import type { ReactNode } from 'react'
import { noIndexMetadata } from '@/lib/seo'

export const metadata = noIndexMetadata('Band workspace')
export default function BandLayout({ children }: { children: ReactNode }) {
  return children
}
 
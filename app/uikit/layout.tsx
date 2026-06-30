import type { ReactNode } from 'react'
import { fontVariables } from '@/lib/fonts'
import { noIndexMetadata } from '@/lib/seo'
import './uikit.css'

export const metadata = noIndexMetadata(
  'UI Kit & Brandbook',
  'The full sonicdesk design system: themes, color tokens, typography, components, motion, and brand voice.',
)

export default function UikitLayout({ children }: { children: ReactNode }) {
  return <div className={fontVariables}>{children}</div>
}

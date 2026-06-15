import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { fontVariables } from '@/lib/fonts'
import './uikit.css'

export const metadata: Metadata = {
  title: 'UI Kit & Brandbook · Trackbase',
  description: 'The full Trackbase design system: themes, color tokens, typography, components, motion, and brand voice.',
}

export default function UikitLayout({ children }: { children: ReactNode }) {
  return <div className={fontVariables}>{children}</div>
}

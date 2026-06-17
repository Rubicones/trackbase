'use client'

import { usePathname } from 'next/navigation'
import { MixLoader } from '@/components/MixLoader'
import { getLoadingLabel } from '@/lib/loadingLabels'

export function RouteMixLoader() {
  const pathname = usePathname()
  return <MixLoader label={getLoadingLabel(pathname)} />
}

import { getVersionDisplayName } from '@/lib/versionSort'

type VersionNameSource = { name: string; type?: 'main' | 'branch' }

/** Master (type=main) uses Archivo so it reads as the canonical project version. */
export function versionListNameClass(version: VersionNameSource): string {
  return version.type === 'main' ? 'font-display' : ''
}

export function VersionListName({
  version,
  className = '',
}: {
  version: VersionNameSource
  className?: string
}) {
  const masterClass = versionListNameClass(version)
  return (
    <span className={[masterClass, className].filter(Boolean).join(' ')}>
      {getVersionDisplayName(version)}
    </span>
  )
}

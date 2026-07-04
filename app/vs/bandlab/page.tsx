import { notFound } from 'next/navigation'
import { noIndexMetadata } from '@/lib/seo'

// REMOVED — comparison pages were rolled back. This stub only exists because
// the file couldn't be deleted from the session; delete the entire app/vs/ folder.
export const metadata = noIndexMetadata('Not found')

export default function Page() {
  notFound()
}
